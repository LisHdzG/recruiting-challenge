// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, db } from '../src/db.js';
import { ordersDal } from '../src/dal/orders-dal.js';

test('orders DAL: create + listByMerchant returns the order', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_test', 'Test')`).run();
  const created = ordersDal.create({
    id: 'o1',
    merchant_id: 'm_test',
    customer_email: 'a@b.com',
    total_amount: 5000,
    type: 'sale',
    status: 'completed',
  });
  assert.equal(created.id, 'o1');
  const list = ordersDal.listByMerchant('m_test');
  assert.equal(list.length, 1);
  assert.equal(list[0]!.total_amount, 5000);
});

test('orders DAL: getById returns the order to the merchant that owns it', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_test', 'Test')`).run();
  ordersDal.create({
    id: 'o2',
    merchant_id: 'm_test',
    customer_email: 'c@d.com',
    total_amount: 1200,
    type: 'sale',
    status: 'completed',
  });
  const got = ordersDal.getById('o2', 'm_test');
  assert.equal(got?.total_amount, 1200);
});

test('orders DAL: getById does not return an order to another merchant', () => {
  initSchema();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_owner', 'Owner')`).run();
  db.prepare(`INSERT OR IGNORE INTO merchants (id, name) VALUES ('m_other', 'Other')`).run();
  ordersDal.create({
    id: 'o3',
    merchant_id: 'm_owner',
    customer_email: 'e@f.com',
    total_amount: 900,
    type: 'sale',
    status: 'completed',
  });
  assert.equal(ordersDal.getById('o3', 'm_other'), undefined);
  assert.equal(ordersDal.getById('o3', 'm_owner')?.id, 'o3');
});
