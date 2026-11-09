// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { seedIfEmpty } from '../src/scripts/seed.js';
import { findMerchantIdByApiKey } from '../src/api-keys.js';

test('seed: issues one working key per merchant, and only the first time', () => {
  const issued = seedIfEmpty();
  assert.deepEqual(issued.map((k) => k.merchantId).sort(), ['m_acme', 'm_bistro']);
  for (const { merchantId, apiKey } of issued) {
    assert.equal(findMerchantIdByApiKey(apiKey), merchantId);
  }
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as { n: number }).n, 80);

  assert.deepEqual(seedIfEmpty(), []);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as { n: number }).n, 80);
});

test('seed: reseeding orders for existing merchants keeps their keys', () => {
  const before = db.prepare(`SELECT id, api_key_hash FROM merchants ORDER BY id`).all();
  db.prepare(`DELETE FROM orders`).run();
  assert.deepEqual(seedIfEmpty(), []);
  assert.deepEqual(db.prepare(`SELECT id, api_key_hash FROM merchants ORDER BY id`).all(), before);
});
