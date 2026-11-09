// The money rules (src/dal/order-rules.ts) over real HTTP, on revenue and metrics.
// routes/metrics.ts opens its own read-only connection, which SQLite refuses for
// an in-memory database, so this file uses a database file in a temp folder.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'dashboard-test-'));
process.env.DB_PATH = join(dir, 'test.db');

const { db, initSchema } = await import('../src/db.js');
initSchema();
const { issueApiKey } = await import('../src/api-keys.js');
const { authMiddleware } = await import('../src/auth.js');
const { ordersRouter } = await import('../src/routes/orders.js');
const { revenueRouter } = await import('../src/routes/revenue.js');
const { metricsRouter } = await import('../src/routes/metrics.js');
const { startApp } = await import('./helpers/app.js');

const keys: Record<string, string> = {};
for (const id of ['m_money', 'm_simple', 'm_empty', 'm_refunds_only']) {
  db.prepare(`INSERT INTO merchants (id, name) VALUES (?, ?)`).run(id, id);
  keys[id] = issueApiKey(id);
}

let n = 0;
const insert = db.prepare(
  `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
);
function order(merchant: string, email: string, amount: number, type: string, day: string): void {
  n += 1;
  insert.run(`o${n}`, merchant, `${email}@example.com`, amount, type, `${day}T12:00:00.000Z`);
}

// m_money: every case the rules name.
order('m_money', 'ana', 10000, 'sale', '2026-10-05');
order('m_money', 'ana', 4000, 'refund', '2026-10-20');
order('m_money', 'bruno', 20000, 'sale', '2026-10-10');
order('m_money', 'carla', 5000, 'sale', '2026-10-12'); // fully refunded: net 0
order('m_money', 'carla', 5000, 'refund', '2026-10-13');
order('m_money', 'diego', 3000, 'refund', '2026-10-15'); // refund with no sale
order('m_money', 'elena', 7000, 'sale', '2026-09-10'); // sold in September...
order('m_money', 'elena', 2000, 'refund', '2026-11-02'); // ...refunded in November
// Rows the API would reject today; they can only predate validation or come from a direct write.
order('m_money', 'legacy', 99999, 'chargeback', '2026-10-18');
order('m_money', 'legacy', -500, 'sale', '2026-10-18');
order('m_money', 'legacy', 12.5, 'sale', '2026-10-18');
order('m_money', 'legacy', -300, 'refund', '2026-10-18');
order('m_money', 'legacy', 200_000_000, 'sale', '2026-10-18');

// m_simple: every customer ends above zero, so revenue and top-customers must add up to the same.
order('m_simple', 'a', 3000, 'sale', '2026-10-01');
order('m_simple', 'a', 1000, 'refund', '2026-10-02');
order('m_simple', 'b', 2500, 'sale', '2026-10-03');
order('m_simple', 'b', 2500, 'sale', '2026-10-04');
order('m_simple', 'b', 700, 'refund', '2026-10-05');

order('m_refunds_only', 'x', 1500, 'refund', '2026-10-01');

let url = '';
let close: () => Promise<void> = async () => {};
before(async () => {
  ({ url, close } = await startApp((app) => {
    app.use('/api/orders', authMiddleware, ordersRouter);
    app.use('/api/revenue', authMiddleware, revenueRouter);
    app.use('/api/metrics', authMiddleware, metricsRouter);
  }));
});
after(async () => {
  await close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function get(merchant: string, path: string): Promise<any> {
  const res = await fetch(url + path, { headers: { Authorization: `Bearer ${keys[merchant]}` } });
  assert.equal(res.status, 200, path);
  return res.json();
}
const revenue = async (merchant: string, from: string, to: string) =>
  (await get(merchant, `/api/revenue?from=${from}&to=${to}`)).revenue_cents;

test('revenue: sales minus refunds', async () => {
  // October: 10000 - 4000 + 20000 + 5000 - 5000 - 3000
  assert.equal(await revenue('m_money', '2026-10-01', '2026-11-01'), 23000);
});

test('revenue: a refund subtracts in the period it was created, so a period can be negative', async () => {
  assert.equal(await revenue('m_money', '2026-09-01', '2026-10-01'), 7000);
  assert.equal(await revenue('m_money', '2026-11-01', '2026-12-01'), -2000);
  const body = await get('m_money', '/api/revenue?from=2026-11-01&to=2026-12-01');
  assert.equal(body.revenue, -20);
});

test('revenue: rows the API would reject today are worth nothing', async () => {
  // 2026-10-18 holds only the legacy rows: unknown type, negative, decimal, negative refund, over the maximum.
  assert.equal(await revenue('m_money', '2026-10-18', '2026-10-19'), 0);
});

test('summary: orders, customers and average count sales only', async () => {
  const summary = await get('m_money', '/api/metrics/summary');
  // Sales: ana 10000, bruno 20000, carla 5000, elena 7000. diego only has a refund; legacy has no valid row.
  assert.deepEqual(summary, {
    merchant_id: 'm_money',
    total_orders: 4,
    unique_customers: 4,
    avg_order_value_cents: 10500,
  });
});

test('top customers: ranked by net spent, sales counted, no customer at zero or below', async () => {
  const { customers } = await get('m_money', '/api/metrics/top-customers?limit=100');
  assert.deepEqual(customers, [
    { customer_email: 'bruno@example.com', order_count: 1, total_spent: 20000 },
    { customer_email: 'ana@example.com', order_count: 1, total_spent: 6000 },
    { customer_email: 'elena@example.com', order_count: 1, total_spent: 5000 },
  ]);
});

test('revenue and top customers agree when every customer ends above zero', async () => {
  const { customers } = await get('m_simple', '/api/metrics/top-customers?limit=100');
  assert.deepEqual(customers, [
    { customer_email: 'b@example.com', order_count: 2, total_spent: 4300 },
    { customer_email: 'a@example.com', order_count: 1, total_spent: 2000 },
  ]);
  const spent = customers.reduce((sum: number, c: { total_spent: number }) => sum + c.total_spent, 0);
  assert.equal(await revenue('m_simple', '2026-01-01', '2027-01-01'), spent);
});

test('a merchant with no orders, or with refunds only, gets zeros and not an error', async () => {
  const zeros = { total_orders: 0, unique_customers: 0, avg_order_value_cents: 0 };
  assert.deepEqual(await get('m_empty', '/api/metrics/summary'), { merchant_id: 'm_empty', ...zeros });
  assert.deepEqual((await get('m_empty', '/api/metrics/top-customers')).customers, []);
  assert.equal(await revenue('m_empty', '2026-01-01', '2027-01-01'), 0);

  assert.deepEqual(await get('m_refunds_only', '/api/metrics/summary'), { merchant_id: 'm_refunds_only', ...zeros });
  assert.deepEqual((await get('m_refunds_only', '/api/metrics/top-customers')).customers, []);
  assert.equal(await revenue('m_refunds_only', '2026-01-01', '2027-01-01'), -1500);
});

test('the order list is not filtered by the money rules: refunds and old rows are still listed', async () => {
  const { orders } = await get('m_money', '/api/orders?limit=100');
  assert.equal(orders.length, 13);
  assert.equal(orders.filter((o: { type: string }) => o.type === 'refund').length, 5);
});
