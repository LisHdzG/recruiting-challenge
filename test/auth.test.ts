// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { initSchema, db } from '../src/db.js';
import { authMiddleware } from '../src/auth.js';
import { issueApiKey, hashApiKey } from '../src/api-keys.js';

initSchema();
db.prepare(`INSERT INTO merchants (id, name) VALUES ('m_a', 'A'), ('m_b', 'B'), ('m_nokey', 'No key')`).run();
const keyA = issueApiKey('m_a');
const keyB = issueApiKey('m_b');

/** Runs the middleware against a fake request and reports what it did. */
function run(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { header: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
  const result: { status?: number; body?: unknown; nextCalled: boolean; merchantId?: string } = {
    nextCalled: false,
  };
  const res = {
    status(code: number) { result.status = code; return res; },
    set() { return res; },
    json(body: unknown) { result.body = body; return res; },
  } as unknown as Response;
  authMiddleware(req, res, () => { result.nextCalled = true; });
  result.merchantId = req.merchantId;
  return result;
}

function assertRejected(headers: Record<string, string>) {
  const r = run(headers);
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'unauthorized' });
  assert.equal(r.nextCalled, false);
  assert.equal(r.merchantId, undefined);
}

test('auth: a valid key resolves to its own merchant', () => {
  assert.deepEqual(run({ Authorization: `Bearer ${keyA}` }), { nextCalled: true, merchantId: 'm_a' });
  assert.deepEqual(run({ Authorization: `Bearer ${keyB}` }), { nextCalled: true, merchantId: 'm_b' });
});

test('auth: the Bearer scheme is case-insensitive', () => {
  assert.equal(run({ authorization: `bearer ${keyA}` }).merchantId, 'm_a');
});

test('auth: X-Merchant-Id alone is rejected', () => {
  assertRejected({ 'X-Merchant-Id': 'm_a' });
});

test('auth: X-Merchant-Id cannot override the merchant of the key', () => {
  const r = run({ Authorization: `Bearer ${keyA}`, 'X-Merchant-Id': 'm_b' });
  assert.equal(r.merchantId, 'm_a');
});

test('auth: missing, unknown and malformed credentials are rejected', () => {
  assertRejected({});
  assertRejected({ Authorization: 'Bearer mk_not_a_real_key' });
  assertRejected({ Authorization: 'Bearer ' });
  assertRejected({ Authorization: keyA });
  assertRejected({ Authorization: `Basic ${keyA}` });
  assertRejected({ Authorization: 'Bearer m_a' });
});

test('auth: a merchant without a key cannot be reached with an empty or null-like key', () => {
  assertRejected({ Authorization: 'Bearer' });
  assertRejected({ Authorization: 'Bearer null' });
  assertRejected({ Authorization: 'Bearer m_nokey' });
});

test('auth: the database stores only the hash, and the hash is not a credential', () => {
  const row = db.prepare(`SELECT api_key_hash FROM merchants WHERE id = 'm_a'`).get() as { api_key_hash: string };
  assert.equal(row.api_key_hash, hashApiKey(keyA));
  assert.notEqual(row.api_key_hash, keyA);
  assertRejected({ Authorization: `Bearer ${row.api_key_hash}` });
});
