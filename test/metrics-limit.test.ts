// routes/metrics.ts opens its own read-only connection, which SQLite refuses for
// an in-memory database, so this file uses a database file in a temp folder.
// It must be set before the db module is imported, hence the dynamic imports.
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
const { metricsRouter } = await import('../src/routes/metrics.js');
const { startApp, fields } = await import('./helpers/app.js');

db.prepare(`INSERT INTO merchants (id, name) VALUES ('m_a', 'A')`).run();
const key = issueApiKey('m_a');
const insert = db.prepare(`INSERT INTO orders (id, merchant_id, customer_email, total_amount) VALUES (?, 'm_a', ?, ?)`);
for (let i = 1; i <= 7; i += 1) insert.run(`o${i}`, `c${i}@example.com`, i * 100);

let url = '';
let close: () => Promise<void> = async () => {};
before(async () => {
  ({ url, close } = await startApp((app) => app.use('/api/metrics', authMiddleware, metricsRouter)));
});
after(async () => {
  await close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function get(path: string) {
  const res = await fetch(url + path, { headers: { Authorization: `Bearer ${key}` } });
  return { status: res.status, body: (await res.json()) as any };
}

test('metrics summary: still answers (the dashboard calls it with no parameters)', async () => {
  const r = await get('/api/metrics/summary');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { merchant_id: 'm_a', total_orders: 7, unique_customers: 7, avg_order_value_cents: 400 });
});

test('top customers: default 5, and a valid limit is applied', async () => {
  assert.equal((await get('/api/metrics/top-customers')).body.customers.length, 5);
  assert.equal((await get('/api/metrics/top-customers?limit=3')).body.customers.length, 3);
  assert.equal((await get('/api/metrics/top-customers?limit=100')).body.customers.length, 7);
});

test('top customers: invalid limit is 400, never a 500 and never "no cap"', async () => {
  for (const q of [
    'limit=-1', 'limit=0', 'limit=', 'limit=101', 'limit=abc', 'limit=1.5', 'limit=0x3', 'limit=true',
    'limit=3&limit=1', 'limit[]=3', 'limit[]=3&limit[]=1', 'limit[a]=3',
  ]) {
    const r = await get(`/api/metrics/top-customers?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error, 'invalid_request', q);
    assert.deepEqual(fields(r), ['limit'], q);
  }
});

test('metrics: arrays and objects are rejected on routes that take no parameters too', async () => {
  const r = await get('/api/metrics/summary?anything[]=1');
  assert.equal(r.status, 400);
  assert.deepEqual(fields(r), ['anything']);
});
