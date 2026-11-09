// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import { initSchema, migrateOrders, db } from '../src/db.js';
import { authMiddleware } from '../src/auth.js';
import { issueApiKey } from '../src/api-keys.js';
import { ordersRouter } from '../src/routes/orders.js';
import { revenueRouter } from '../src/routes/revenue.js';
import { validated } from '../src/validate-request.js';
import { startApp, fields, type Reply } from './helpers/app.js';

initSchema();
migrateOrders(); // the indexes the order list needs
db.prepare(`INSERT INTO merchants (id, name) VALUES ('m_a', 'A'), ('m_b', 'B')`).run();
const keyA = issueApiKey('m_a');

let url = '';
let close: () => Promise<void> = async () => {};
const logged = mock.method(console, 'error', () => {});

before(async () => {
  const boom = Router();
  boom.get('/', validated({}, () => { throw new Error('database exploded'); }));
  const unauthenticated = Router();
  unauthenticated.get('/', validated({}, (_input, res) => { res.json({ reached: true }); }));

  ({ url, close } = await startApp((app) => {
    app.use('/api/orders', authMiddleware, ordersRouter);
    app.use('/api/revenue', authMiddleware, revenueRouter);
    app.use('/api/boom', authMiddleware, boom);
    app.use('/api/no-auth', unauthenticated);
  }));
});
after(() => close());

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; raw?: string; headers?: Record<string, string>; key?: string | null } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.key !== null) headers.Authorization = `Bearer ${opts.key ?? keyA}`;
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url + path, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, body: parsed };
}
const get = (path: string) => call('GET', path);
const post = (body: unknown) => call('POST', '/api/orders', { body });
const orderCount = () => (db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as { n: number }).n;

/** A 400 in the shared format that names exactly these fields. */
function assertInvalid(reply: Reply, expectedFields: string[], label = '') {
  assert.equal(reply.status, 400, `${label} ${JSON.stringify(reply.body)}`);
  assert.equal(reply.body.error, 'invalid_request', label);
  assert.deepEqual(fields(reply), expectedFields, label);
  for (const d of reply.body.details) assert.equal(typeof d.issue, 'string');
}

const valid = { customer_email: 'ana@example.com', total_amount: 5000 };

// --- POST /api/orders ---------------------------------------------------------

test('POST orders: valid orders are still created', async () => {
  const sale = await post(valid);
  assert.equal(sale.status, 201);
  assert.deepEqual(
    { ...sale.body.order, id: '', created_at: '' },
    { id: '', merchant_id: 'm_a', customer_email: 'ana@example.com', total_amount: 5000, type: 'sale', status: 'completed', created_at: '' },
  );
  const refund = await post({ ...valid, type: 'refund' });
  assert.equal(refund.status, 201);
  assert.equal(refund.body.order.type, 'refund');
});

test('POST orders: fields the API does not take cannot be set by the client', async () => {
  const r = await post({ ...valid, id: 'mine', merchant_id: 'm_b', status: 'hack', created_at: '1999-01-01' });
  assert.equal(r.status, 201);
  assert.notEqual(r.body.order.id, 'mine');
  assert.equal(r.body.order.merchant_id, 'm_a');
  assert.equal(r.body.order.status, 'completed');
  assert.notEqual(r.body.order.created_at, '1999-01-01');
});

test('POST orders: invalid values are rejected with 400 and nothing is stored', async () => {
  const before = orderCount();
  const cases: Array<[unknown, string[]]> = [
    [{ ...valid, total_amount: -500 }, ['total_amount']],
    [{ ...valid, total_amount: 0 }, ['total_amount']],
    [{ ...valid, total_amount: 12.5 }, ['total_amount']],
    [{ ...valid, total_amount: 1e30 }, ['total_amount']],
    [{ ...valid, total_amount: 100_000_001 }, ['total_amount']],
    [{ ...valid, total_amount: '500' }, ['total_amount']],
    [{ ...valid, total_amount: null }, ['total_amount']],
    [{ ...valid, type: 'banana' }, ['type']],
    [{ ...valid, type: '' }, ['type']],
    [{ ...valid, type: 5 }, ['type']],
    [{ ...valid, type: null }, ['type']],
    [{ ...valid, customer_email: 'no-es-un-email' }, ['customer_email']],
    [{ ...valid, customer_email: '   ' }, ['customer_email']],
    [{ ...valid, customer_email: 123 }, ['customer_email']],
    [{ ...valid, customer_email: true }, ['customer_email']],
    [{ ...valid, customer_email: `${'a'.repeat(90_000)}@x.com` }, ['customer_email']],
    [{ ...valid, customer_email: '<b>hola</b>@x.com' }, ['customer_email']],
    [{ ...valid, customer_email: '<img/src=x/onerror=alert(1)>@x.com' }, ['customer_email']],
    [{}, ['customer_email', 'total_amount']],
    [{ customer_email: 'x', total_amount: -1, type: 'z' }, ['customer_email', 'total_amount', 'type']],
  ];
  for (const [body, expected] of cases) assertInvalid(await post(body), expected, JSON.stringify(body).slice(0, 80));
  assert.equal(orderCount(), before);
});

test('POST orders: 1e400 (parsed as Infinity) is rejected', async () => {
  const before = orderCount();
  assertInvalid(await call('POST', '/api/orders', { raw: '{"customer_email":"a@x.com","total_amount":1e400}' }), ['total_amount']);
  assert.equal(orderCount(), before);
});

test('POST orders: arrays and objects are rejected, including the ones that used to shift columns', async () => {
  const before = orderCount();
  const nested: Array<[unknown, string[]]> = [
    [{ customer_email: [], total_amount: 777, type: ['a', 'b'] }, ['customer_email', 'type']],
    [{ customer_email: ['e@x.com', 123], total_amount: 5, type: [] }, ['customer_email', 'type']],
    [{ ...valid, customer_email: ['a@x.com'] }, ['customer_email']],
    [{ ...valid, customer_email: { a: 1 } }, ['customer_email']],
    [{ ...valid, total_amount: [500] }, ['total_amount']],
    [{ ...valid, type: {} }, ['type']],
    [{ ...valid, anything_else: ['x'] }, ['anything_else']],
    [[], ['body']],
    [[valid], ['body']],
  ];
  for (const [body, expected] of nested) assertInvalid(await post(body), expected, JSON.stringify(body));
  assert.equal(orderCount(), before);
});

test('POST orders: a body that is not readable JSON is the client\'s error, not a 500', async () => {
  const before = orderCount();
  for (const raw of ['{x', 'null', '"hola"', '5']) {
    assertInvalid(await call('POST', '/api/orders', { raw }), ['body'], raw);
  }
  // no body, or a body the JSON parser does not read: nothing arrives, so the fields are missing
  assertInvalid(await call('POST', '/api/orders'), ['customer_email', 'total_amount']);
  assertInvalid(
    await call('POST', '/api/orders', { raw: JSON.stringify(valid), headers: { 'Content-Type': 'text/plain' } }),
    ['customer_email', 'total_amount'],
  );
  assert.equal(orderCount(), before);
});

test('POST orders: too large is 413 and unsupported charset is 415, in the same error shape', async () => {
  const before = orderCount();
  const big = await post({ ...valid, customer_email: `${'a'.repeat(200_000)}@x.com` });
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'payload_too_large');
  assert.deepEqual(fields(big), ['body']);

  const charset = await call('POST', '/api/orders', {
    raw: JSON.stringify(valid),
    headers: { 'Content-Type': 'application/json; charset=foo' },
  });
  assert.equal(charset.status, 415);
  assert.equal(charset.body.error, 'unsupported_media_type');
  assert.deepEqual(fields(charset), ['Content-Type']);
  assert.equal(orderCount(), before);
});

// --- GET /api/orders ------------------------------------------------------------

test('GET orders: valid requests, including the ones the dashboard sends', async () => {
  assert.equal((await get('/api/orders')).status, 200);
  const ten = await get('/api/orders?limit=10');
  assert.equal(ten.status, 200);
  assert.ok(Array.isArray(ten.body.orders));
  assert.equal((await get('/api/orders?limit=1')).body.orders.length, 1);
  assert.equal((await get('/api/orders?limit=100')).status, 200);
  assert.equal((await get('/api/orders?from=2020-01-01&to=2099-01-01&limit=5')).status, 200);
  assert.equal((await get('/api/orders?foo=bar')).status, 200); // unknown single values are ignored
});

test('GET orders: invalid limit is 400, never a 500 and never "no cap"', async () => {
  for (const q of [
    'limit=-1', 'limit=0', 'limit=', 'limit=101', 'limit=abc', 'limit=1.5', 'limit=1e2', 'limit=0x3',
    'limit=Infinity', 'limit=99999999999999999999', 'limit=%203%20',
    'limit=3&limit=1', 'limit[]=3', 'limit[a]=3',
  ]) {
    assertInvalid(await get(`/api/orders?${q}`), ['limit'], q);
  }
});

test('GET orders: a date filter is applied in full or rejected, never silently ignored', async () => {
  const cases: Array<[string, string[]]> = [
    ['from=2099-01-01', ['to']],
    ['to=2000-01-01', ['from']],
    ['from=&to=', ['from', 'to']],
    ['from=hola&to=adios', ['from', 'to']],
    ['from=2026-12-01&to=2026-01-01', ['to']],
    ['from=2026-11-06&to=2026-11-06', ['to']],
    ['from=2026-02-30&to=2026-03-01', ['from']],
    ['from=2026-11-06T00:00:00Z&to=2026-11-07T00:00:00Z', ['from', 'to']],
    ['from=2099-01-01&from=2000-01-01&to=2100-01-01', ['from']],
    ['from[]=2099-01-01&to=2100-01-01', ['from']],
    ['from=2099-01-01&limit=-1', ['to', 'limit']],
    ['foo[]=1', ['foo']],
    ['foo[a]=1', ['foo']],
  ];
  for (const [q, expected] of cases) assertInvalid(await get(`/api/orders?${q}`), expected, q);
});

// --- GET /api/revenue -----------------------------------------------------------

test('GET revenue: the same date rule as orders, with both dates required', async () => {
  const ok = await get('/api/revenue?from=2020-01-01&to=2099-01-01');
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.body.revenue_cents, 'number');
  assert.deepEqual([ok.body.from, ok.body.to], ['2020-01-01', '2099-01-01']);

  const cases: Array<[string, string[]]> = [
    ['', ['from', 'to']],
    ['from=2026-01-01', ['to']],
    ['from=hola&to=adios', ['from', 'to']],
    ['from=2026-1-1&to=2027-1-1', ['from', 'to']],
    ['from=01/01/2026&to=01/01/2027', ['from', 'to']],
    ['from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z', ['from', 'to']],
    ['from=2026-02-30&to=2026-13-45', ['from', 'to']],
    ['from=2026-12-01&to=2026-01-01', ['to']],
    ['from=%20&to=%20', ['from', 'to']],
    ['from=2026-01-01&from=2025-01-01&to=2027-01-01', ['from']],
    ['from[]=2026-01-01&to[]=2027-01-01', ['from', 'to']],
  ];
  for (const [q, expected] of cases) assertInvalid(await get(`/api/revenue?${q}`), expected, q);
});

test('dates: a YYYY-MM-DD range is correct against both stored timestamp formats', async () => {
  db.prepare(`INSERT INTO merchants (id, name) VALUES ('m_dates', 'Dates')`).run();
  const key = issueApiKey('m_dates');
  const insert = db.prepare(
    `INSERT INTO orders (id, merchant_id, customer_email, total_amount, created_at) VALUES (?, 'm_dates', 'a@x.com', ?, ?)`,
  );
  // [created_at, belongs to 2026-11-06 UTC]. Seed rows use the ISO form, API rows the SQLite form.
  const rows: Array<[string, boolean]> = [
    ['2026-11-05T23:59:59.999Z', false], ['2026-11-05 23:59:59', false],
    ['2026-11-06T00:00:00.000Z', true], ['2026-11-06 00:00:00', true],
    ['2026-11-06T12:00:00.000Z', true], ['2026-11-06 12:00:00', true],
    ['2026-11-06T23:59:59.999Z', true], ['2026-11-06 23:59:59', true],
    ['2026-11-07T00:00:00.000Z', false], ['2026-11-07 00:00:00', false],
  ];
  rows.forEach(([at], i) => insert.run(`d${i}`, 10 ** i, at));
  const expectedIds = rows.flatMap(([, inDay], i) => (inDay ? [`d${i}`] : [])).sort();
  const expectedSum = rows.reduce((sum, [, inDay], i) => sum + (inDay ? 10 ** i : 0), 0);

  const list = await call('GET', '/api/orders?from=2026-11-06&to=2026-11-07', { key });
  assert.deepEqual(list.body.orders.map((o: { id: string }) => o.id).sort(), expectedIds);
  const revenue = await call('GET', '/api/revenue?from=2026-11-06&to=2026-11-07', { key });
  assert.equal(revenue.body.revenue_cents, expectedSum);
});

// --- errors ---------------------------------------------------------------------

test('errors: authentication comes before validation, so an invalid request without a key is 401', async () => {
  for (const [method, path, body] of [
    ['GET', '/api/orders', undefined],
    ['GET', '/api/orders?limit[]=1', undefined],
    ['GET', '/api/orders?limit=1&limit=2', undefined],
    ['GET', '/api/orders?limit=-1', undefined],
    ['GET', '/api/revenue?from[a]=x', undefined],
    ['POST', '/api/orders', { customer_email: [], total_amount: -1 }],
  ] as const) {
    const r = await call(method, path, { key: null, body });
    assert.equal(r.status, 401, path);
    assert.deepEqual(r.body, { error: 'unauthorized' }, path);
  }
  const wrongKey = await call('GET', '/api/orders?limit[]=1', { key: 'mk_not_a_real_key' });
  assert.equal(wrongKey.status, 401);
});

test('errors: a path that is not valid URL encoding is 400', async () => {
  assertInvalid(await get('/api/orders/%E0%A4%A'), ['path']);
});

test('errors: client errors are not logged as server errors', () => {
  assert.equal(logged.mock.callCount(), 0);
});

test('errors: a real server failure is still 500 internal_error, with the detail only in the log', async () => {
  const r = await get('/api/boom');
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'internal_error' });
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0]!.arguments[0]), /database exploded/);
});

test('errors: a validated() route mounted without authentication fails closed', async () => {
  const r = await call('GET', '/api/no-auth', { key: null });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'internal_error' });
});
