// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, initSchema, migrateOrders, pendingMigrations, IDX_ORDERS_BY_DATE, IDX_ORDERS_BY_EMAIL } from '../src/db.js';
import { migrate } from '../src/scripts/migrate.js';
import { ordersDal } from '../src/dal/orders-dal.js';

// The order part of `npm run migrate`: one created_at format and the indexes
// of the order list, and what the server checks before it starts.

// A database as the previous version left it: the old column default, both
// timestamp formats, and no order-list indexes.
db.exec(`
  CREATE TABLE merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key_hash TEXT UNIQUE,
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
  CREATE INDEX idx_orders_merchant ON orders(merchant_id);
  CREATE INDEX idx_orders_created ON orders(created_at);
  INSERT INTO merchants (id, name, api_key_hash) VALUES ('m_old', 'Old', 'hash');
  INSERT INTO orders (id, merchant_id, customer_email, total_amount, created_at) VALUES
    ('seed_early', 'm_old', 'a@x.com', 100, '2026-11-09T00:00:01.000Z'),
    ('api_late',   'm_old', 'a@x.com', 200, '2026-11-09 21:39:15'),
    ('api_prev',   'm_old', 'a@x.com', 300, '2026-11-08 23:59:59'),
    ('no_millis',  'm_old', 'a@x.com', 400, '2026-11-07T08:00:00Z'),
    ('offset',     'm_old', 'a@x.com', 500, '2026-11-06T20:00:00+02:00');
`);
const createdAt = (id: string) => (db.prepare(`SELECT created_at FROM orders WHERE id = ?`).get(id) as { created_at: string }).created_at;

test('before migrating: the server would refuse to start, and says why', () => {
  assert.deepEqual(pendingMigrations(), [
    'some orders store `created_at` in the old format',
    `index ${IDX_ORDERS_BY_DATE} is missing`,
    `index ${IDX_ORDERS_BY_EMAIL} is missing`,
  ]);
});

test('migrate: rewrites every created_at to the one format without moving the instant, and creates the indexes', () => {
  const { orders } = migrate();
  assert.deepEqual(orders, { datesRewritten: 4, datesUnreadable: 0, indexesCreated: [IDX_ORDERS_BY_DATE, IDX_ORDERS_BY_EMAIL] });
  assert.equal(createdAt('seed_early'), '2026-11-09T00:00:01.000Z'); // already in the format: untouched
  assert.equal(createdAt('api_late'), '2026-11-09T21:39:15.000Z');
  assert.equal(createdAt('api_prev'), '2026-11-08T23:59:59.000Z');
  assert.equal(createdAt('no_millis'), '2026-11-07T08:00:00.000Z');
  assert.equal(createdAt('offset'), '2026-11-06T18:00:00.000Z'); // converted to UTC
  assert.deepEqual(pendingMigrations(), []);
});

test('migrate: after it, "newest first" is right inside the same day', () => {
  // Before: the seed row of 00:00:01 was listed ahead of the API row of 21:39:15 ("T" sorts after " ").
  assert.deepEqual(
    ordersDal.listByMerchant('m_old').orders.map((o) => o.id),
    ['api_late', 'seed_early', 'api_prev', 'no_millis', 'offset'],
  );
});

test('migrate: running it again changes nothing', () => {
  assert.deepEqual(migrate().orders, { datesRewritten: 0, datesUnreadable: 0, indexesCreated: [] });
  assert.deepEqual(migrateOrders(), { datesRewritten: 0, datesUnreadable: 0, indexesCreated: [] });
});

test('migrate: an order written later in the old format is pending again, and one run fixes it', () => {
  db.prepare(`INSERT INTO orders (id, merchant_id, customer_email, total_amount) VALUES ('direct', 'm_old', 'a@x.com', 1)`).run();
  assert.deepEqual(pendingMigrations(), ['some orders store `created_at` in the old format']);
  assert.equal(migrateOrders().datesRewritten, 1);
  assert.deepEqual(pendingMigrations(), []);
});

test('migrate: a created_at that is not a date is left alone, reported, and does not keep the server down', () => {
  db.prepare(`INSERT INTO orders (id, merchant_id, customer_email, total_amount, created_at) VALUES ('junk', 'm_old', 'a@x.com', 1, 'banana')`).run();
  assert.deepEqual(migrateOrders(), { datesRewritten: 0, datesUnreadable: 1, indexesCreated: [] });
  assert.equal(createdAt('junk'), 'banana');
  assert.deepEqual(pendingMigrations(), []);
  db.prepare(`DELETE FROM orders WHERE id = 'junk'`).run();
});

test('migrate: a missing index is pending on its own, and only that one is created', () => {
  db.exec(`DROP INDEX ${IDX_ORDERS_BY_EMAIL}`);
  assert.deepEqual(pendingMigrations(), [`index ${IDX_ORDERS_BY_EMAIL} is missing`]);
  assert.deepEqual(migrateOrders().indexesCreated, [IDX_ORDERS_BY_EMAIL]);
});

test('new database: initSchema alone is not enough to start; orders created through the DAL need no date migration', () => {
  db.exec(`DROP TABLE orders`);
  initSchema();
  assert.deepEqual(pendingMigrations(), [`index ${IDX_ORDERS_BY_DATE} is missing`, `index ${IDX_ORDERS_BY_EMAIL} is missing`]);
  migrateOrders();
  ordersDal.create({ id: 'fresh', merchant_id: 'm_old', customer_email: 'a@x.com', total_amount: 1, type: 'sale', status: 'completed' });
  // And a row written straight to a new database gets the one format from the column default.
  db.prepare(`INSERT INTO orders (id, merchant_id, customer_email, total_amount) VALUES ('fresh_direct', 'm_old', 'a@x.com', 1)`).run();
  assert.match(createdAt('fresh'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(createdAt('fresh_direct'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(pendingMigrations(), []);
});
