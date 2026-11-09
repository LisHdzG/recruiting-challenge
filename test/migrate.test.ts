// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, hasApiKeyColumn } from '../src/db.js';
import { migrate } from '../src/scripts/migrate.js';
import { findMerchantIdByApiKey } from '../src/api-keys.js';
import { ordersDal } from '../src/dal/orders-dal.js';

// The schema as it was before API keys existed.
db.exec(`
  CREATE TABLE merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    customer_email TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'sale',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO merchants (id, name) VALUES ('m_old1', 'Old 1'), ('m_old2', 'Old 2');
  INSERT INTO orders (id, merchant_id, customer_email, total_amount) VALUES ('o_old', 'm_old1', 'a@b.com', 100);
`);

test('migrate: adds the column, issues a key per existing merchant and keeps the data', () => {
  assert.equal(hasApiKeyColumn(), false);
  const { issued } = migrate();
  assert.equal(hasApiKeyColumn(), true);
  assert.deepEqual(issued.map((k) => k.merchantId), ['m_old1', 'm_old2']);
  for (const { merchantId, apiKey } of issued) {
    assert.equal(findMerchantIdByApiKey(apiKey), merchantId);
  }
  assert.equal(ordersDal.getById('o_old', 'm_old1')?.total_amount, 100);

  // Running it again must not replace keys that are already in use.
  assert.deepEqual(migrate().issued, []);
  assert.equal(findMerchantIdByApiKey(issued[0]!.apiKey), 'm_old1');
});

test('migrate: a merchant added later without a key gets one on the next run', () => {
  db.prepare(`INSERT INTO merchants (id, name) VALUES ('m_new', 'New')`).run();
  const { issued } = migrate();
  assert.deepEqual(issued.map((k) => k.merchantId), ['m_new']);
});

test('migrate: two merchants cannot share a key hash', () => {
  const hash = (db.prepare(`SELECT api_key_hash FROM merchants WHERE id = 'm_old1'`).get() as { api_key_hash: string }).api_key_hash;
  assert.throws(() => db.prepare(`UPDATE merchants SET api_key_hash = ? WHERE id = 'm_old2'`).run(hash), /UNIQUE/);
});
