// Set DB_PATH before importing the db module — the connection is created on import.
if (!process.env.DB_PATH) process.env.DB_PATH = ':memory:';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, migrateOrders, db, IDX_ORDERS_BY_DATE, IDX_ORDERS_BY_EMAIL } from '../src/db.js';
import { authMiddleware } from '../src/auth.js';
import { issueApiKey } from '../src/api-keys.js';
import { ordersRouter } from '../src/routes/orders.js';
import { buildOrderListQuery, type OrderListFilters } from '../src/dal/orders-dal.js';
import { encodeOrderCursor } from '../src/validation.js';
import { startApp, fields, type Reply } from './helpers/app.js';

// Order search: the filters of GET /api/orders over real HTTP, the cursor, and
// the query plan the 200,000-order measurements depend on.

initSchema();
migrateOrders();
db.prepare(`INSERT INTO merchants (id, name) VALUES ('m_s', 'Search'), ('m_x', 'Other')`).run();
const keyS = issueApiKey('m_s');
const keyX = issueApiKey('m_x');

const insert = db.prepare(
  `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
);
const ROWS: Array<[id: string, email: string, amount: number, type: string, createdAt: string]> = [
  ['o01', 'ana@example.com', 5000, 'sale', '2026-10-01T10:00:00.000Z'],
  ['o02', 'Ana.Lopez@example.com', 12000, 'sale', '2026-10-02T10:00:00.000Z'],
  ['o03', 'ANA@EXAMPLE.COM', 3000, 'refund', '2026-10-03T10:00:00.000Z'],
  ['o04', 'mariana@example.com', 8000, 'sale', '2026-10-04T10:00:00.000Z'], // contains "ana", does not start with it
  ['o05', 'bruno@example.com', 20000, 'sale', '2026-10-05T10:00:00.000Z'],
  ['o06', 'a_b@example.com', 100, 'sale', '2026-10-06T10:00:00.000Z'],
  ['o07', 'axb@example.com', 100, 'sale', '2026-10-06T10:00:00.000Z'], // same instant as o06
  ['o08', 'a%b@example.com', 700, 'refund', '2026-10-07T10:00:00.000Z'],
];
for (const [id, email, amount, type, createdAt] of ROWS) insert.run(id, 'm_s', email, amount, type, createdAt);
insert.run('x01', 'm_x', 'ana@example.com', 5000, 'sale', '2026-10-02T10:00:00.000Z');
insert.run('x02', 'm_x', 'ana@example.com', 6000, 'sale', '2026-10-03T10:00:00.000Z');

const NEWEST_FIRST = ['o08', 'o07', 'o06', 'o05', 'o04', 'o03', 'o02', 'o01'];

let url = '';
let close: () => Promise<void> = async () => {};
before(async () => {
  ({ url, close } = await startApp((app) => app.use('/api/orders', authMiddleware, ordersRouter)));
});
after(() => close());

async function get(query: string, key = keyS): Promise<Reply> {
  const res = await fetch(`${url}/api/orders${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${key}` } });
  return { status: res.status, body: await res.json() };
}
async function ids(query: string, key = keyS): Promise<string[]> {
  const reply = await get(query, key);
  assert.equal(reply.status, 200, `${query} ${JSON.stringify(reply.body)}`);
  return reply.body.orders.map((o: { id: string }) => o.id);
}
const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** Follows `next_cursor` to the end and returns every page. */
async function allPages(query: string, key = keyS): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor: string | null = null;
  do {
    const reply: Reply = await get(cursor ? `${query}&cursor=${cursor}` : query, key);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    pages.push(reply.body.orders.map((o: { id: string }) => o.id));
    cursor = reply.body.next_cursor;
    assert.ok(pages.length <= 20, 'pagination ends');
  } while (cursor);
  return pages;
}

// --- no filters: what the endpoint answered before ---------------------------------

test('search: without filters it lists everything, newest first, with id as the tie-breaker', async () => {
  const reply = await get('');
  assert.deepEqual(reply.body.orders.map((o: { id: string }) => o.id), NEWEST_FIRST);
  assert.equal(reply.body.next_cursor, null);
  assert.deepEqual(Object.keys(reply.body).sort(), ['next_cursor', 'orders']);
});

// --- customer_email ----------------------------------------------------------------

test('search: customer_email matches the start of the email, ignoring case', async () => {
  for (const prefix of ['ana', 'ANA', 'aNa']) assert.deepEqual(await ids(q({ customer_email: prefix })), ['o03', 'o02', 'o01'], prefix);
  assert.deepEqual(await ids(q({ customer_email: 'ana@' })), ['o03', 'o01']);
  assert.deepEqual(await ids(q({ customer_email: 'ana.lopez@example.com' })), ['o02']);
  assert.deepEqual(await ids(q({ customer_email: 'mari' })), ['o04']);
  assert.deepEqual(await ids(q({ customer_email: 'a' })), ['o08', 'o07', 'o06', 'o03', 'o02', 'o01']);
  // Not "contains": o04 (mariana) and the domain do not match.
  assert.deepEqual(await ids(q({ customer_email: 'example.com' })), []);
  assert.deepEqual(await ids(q({ customer_email: 'zzz' })), []);
});

test('search: % and _ in customer_email are plain characters, not wildcards', async () => {
  assert.deepEqual(await ids(q({ customer_email: 'a_b' })), ['o06']); // not axb@ (o07)
  assert.deepEqual(await ids(q({ customer_email: 'a%' })), ['o08']); // not "everything that starts with a"
  assert.deepEqual(await ids(q({ customer_email: '%' })), []);
  assert.deepEqual(await ids(q({ customer_email: '_' })), []);
});

test('search: the email range agrees with a plain "starts with" for every prefix of every stored email', async () => {
  for (const [, email] of ROWS) {
    for (let length = 1; length <= email.length; length += 1) {
      const prefix = email.slice(0, length).toUpperCase();
      const expected = ROWS.filter(([, e]) => e.toLowerCase().startsWith(prefix.toLowerCase())).map(([id]) => id).sort();
      assert.deepEqual((await ids(q({ customer_email: prefix }))).sort(), expected, prefix);
    }
  }
});

// --- type, status, amounts, dates ----------------------------------------------------

test('search: type and status', async () => {
  assert.deepEqual(await ids('type=refund'), ['o08', 'o03']);
  assert.deepEqual(await ids('type=sale'), ['o07', 'o06', 'o05', 'o04', 'o02', 'o01']);
  assert.deepEqual(await ids('status=completed'), NEWEST_FIRST);
});

test('search: amount bounds are in cents and inclusive, each one usable alone', async () => {
  assert.deepEqual(await ids('min_amount=5000&max_amount=12000'), ['o04', 'o02', 'o01']);
  assert.deepEqual(await ids('min_amount=12000'), ['o05', 'o02']);
  assert.deepEqual(await ids('max_amount=100'), ['o07', 'o06']);
  assert.deepEqual(await ids('min_amount=700&max_amount=700'), ['o08']); // a refund is found by its positive amount
});

test('search: the date range keeps its rule (from inclusive, to exclusive, UTC days)', async () => {
  assert.deepEqual(await ids('from=2026-10-03&to=2026-10-06'), ['o05', 'o04', 'o03']);
});

test('search: filters combine with AND', async () => {
  assert.deepEqual(await ids(q({ customer_email: 'ana', type: 'sale' })), ['o02', 'o01']);
  assert.deepEqual(await ids(q({ customer_email: 'a', type: 'sale', max_amount: '5000', from: '2026-10-01', to: '2026-10-07' })), ['o07', 'o06', 'o01']);
  assert.deepEqual(await ids(q({ customer_email: 'ana', type: 'refund', status: 'completed', min_amount: '3000', max_amount: '3000' })), ['o03']);
  assert.deepEqual(await ids(q({ customer_email: 'bruno', type: 'refund' })), []);
});

// --- tenancy -------------------------------------------------------------------------

test('search: a filter never reaches another merchant, and a merchant id sent by the client is ignored', async () => {
  assert.deepEqual(await ids(q({ customer_email: 'ana@example.com' })), ['o03', 'o01']);
  assert.deepEqual(await ids(q({ customer_email: 'ana@example.com' }), keyX), ['x02', 'x01']);
  assert.deepEqual(await ids('merchant_id=m_x&type=sale&min_amount=6000&max_amount=6000'), []);
});

// --- pagination ----------------------------------------------------------------------

test('pagination: following next_cursor returns every order once, in order, even across a tie', async () => {
  for (const limit of [1, 2, 3, 5, 7, 8, 9]) {
    const pages = await allPages(`limit=${limit}`);
    assert.deepEqual(pages.flat(), NEWEST_FIRST, `limit=${limit}`);
    assert.ok(pages.every((page) => page.length <= limit), `limit=${limit}`);
  }
  // limit=2 ends page 1 on o07 and starts page 2 on o06: same created_at, split by id.
  assert.deepEqual((await allPages('limit=2'))[1], ['o06', 'o05']);
});

test('pagination: next_cursor is null exactly when there is nothing left', async () => {
  assert.equal((await get('limit=8')).body.next_cursor, null); // the page is full and it is the last one
  assert.equal(typeof (await get('limit=7')).body.next_cursor, 'string');
  assert.equal((await get('type=refund&limit=2')).body.next_cursor, null);
  assert.equal((await get(q({ customer_email: 'zzz' }))).body.next_cursor, null);
});

test('pagination: the filters apply to every page', async () => {
  assert.deepEqual(await allPages(`${q({ customer_email: 'a' })}&limit=4`), [['o08', 'o07', 'o06', 'o03'], ['o02', 'o01']]);
  assert.deepEqual(await allPages('type=sale&min_amount=5000&limit=2'), [['o05', 'o04'], ['o02', 'o01']]);
});

test('pagination: an order created between two pages is neither repeated nor does it push one out', async () => {
  const first = await get('limit=3');
  insert.run('o99', 'm_s', 'new@example.com', 1, 'sale', '2026-10-08T10:00:00.000Z');
  try {
    const second = await get(`limit=3&cursor=${first.body.next_cursor}`);
    assert.deepEqual(second.body.orders.map((o: { id: string }) => o.id), ['o05', 'o04', 'o03']);
  } finally {
    db.prepare(`DELETE FROM orders WHERE id = 'o99'`).run();
  }
});

test('pagination: a cursor only says where to continue; it cannot reach another merchant', async () => {
  const cursorOfS = (await get('limit=1')).body.next_cursor;
  assert.deepEqual(await ids(`cursor=${cursorOfS}`, keyX), ['x02', 'x01']);
  // A cursor written by hand that points "before everything": still only this merchant's rows.
  const handmade = encodeOrderCursor({ created_at: '9999-12-31T00:00:00.000Z', id: 'x02' });
  assert.deepEqual(await ids(`cursor=${handmade}`), NEWEST_FIRST);
});

// --- invalid input -------------------------------------------------------------------

test('search: each invalid filter is a 400 that names the field', async () => {
  const cases: Array<[string, string[]]> = [
    ['type=banana', ['type']],
    ['type=', ['type']],
    ['type=SALE', ['type']],
    ['status=pending', ['status']],
    ['status=cancelled', ['status']],
    ['status=', ['status']],
    ['customer_email=', ['customer_email']],
    [`customer_email=${'a'.repeat(255)}`, ['customer_email']],
    ['min_amount=0', ['min_amount']],
    ['min_amount=-5', ['min_amount']],
    ['min_amount=12.5', ['min_amount']],
    ['min_amount=abc', ['min_amount']],
    ['min_amount=', ['min_amount']],
    ['max_amount=100000001', ['max_amount']],
    ['max_amount=1e3', ['max_amount']],
    ['min_amount=500&max_amount=100', ['max_amount']],
    ['cursor=', ['cursor']],
    ['cursor=abc', ['cursor']],
    ['cursor=%21%21', ['cursor']],
    [`cursor=${Buffer.from('{"a":1}').toString('base64url')}`, ['cursor']],
    [`cursor=${Buffer.from('["2026-10-01T10:00:00.000Z"]').toString('base64url')}`, ['cursor']],
    [`cursor=${Buffer.from('["2026-10-01T10:00:00.000Z",5]').toString('base64url')}`, ['cursor']],
    [`cursor=${'A'.repeat(513)}`, ['cursor']],
    ['type=sale&type=refund', ['type']],
    ['status[]=completed', ['status']],
    ['customer_email[a]=ana', ['customer_email']],
    ['min_amount=1&min_amount=2', ['min_amount']],
    ['cursor[]=x', ['cursor']],
  ];
  for (const [query, expected] of cases) {
    const reply = await get(query);
    assert.equal(reply.status, 400, `${query} ${JSON.stringify(reply.body)}`);
    assert.equal(reply.body.error, 'invalid_request', query);
    assert.deepEqual(fields(reply), expected, query);
  }
});

test('search: every invalid filter is reported at once', async () => {
  const reply = await get('customer_email=&type=x&status=y&from=2026-10-01&min_amount=z&max_amount=0&limit=0&cursor=!');
  assert.equal(reply.status, 400);
  assert.deepEqual(fields(reply), ['customer_email', 'type', 'status', 'to', 'min_amount', 'max_amount', 'limit', 'cursor']);
});

test('search: valid bounds at the edges are accepted', async () => {
  for (const query of ['min_amount=1', 'max_amount=100000000', 'min_amount=007', `customer_email=${'a'.repeat(254)}`, 'limit=100']) {
    assert.equal((await get(query)).status, 200, query);
  }
});

// --- dates written by the API --------------------------------------------------------

test('created_at: an order created through the API is stored in the one format', async () => {
  const res = await fetch(`${url}/api/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${keyX}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_email: 'zed@example.com', total_amount: 1234 }),
  });
  const { order } = (await res.json()) as { order: { id: string; created_at: string } };
  assert.match(order.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(order.created_at) - Date.now()) < 60_000, 'it is the current time, in UTC');
  assert.equal((await ids('limit=1', keyX))[0], order.id, 'and it lists first: newer than the rows inserted above');
});

// --- query plan ----------------------------------------------------------------------

function plan(filters: OrderListFilters): string {
  const { sql, params } = buildOrderListQuery('m_s', filters, 26);
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
}
const cursor = { created_at: '2026-10-05T10:00:00.000Z', id: 'o05' };

test('plan: without an email filter the rows come from the index already in order (no sort, stops at the page)', () => {
  const variants: OrderListFilters[] = [
    {},
    { cursor },
    { from: '2026-10-01', to: '2026-11-01' },
    { type: 'sale', status: 'completed', min_amount: 1, max_amount: 5000 },
    { from: '2026-10-01', to: '2026-11-01', type: 'refund', status: 'completed', min_amount: 1, max_amount: 5000, cursor },
  ];
  for (const filters of variants) {
    const detail = plan(filters);
    assert.match(detail, new RegExp(`USING INDEX ${IDX_ORDERS_BY_DATE} \\(merchant_id=\\?`), JSON.stringify(filters));
    assert.doesNotMatch(detail, /TEMP B-TREE|SCAN/, JSON.stringify(filters));
  }
});

test('plan: with an email filter the email index narrows to the matching range, never the whole merchant', () => {
  for (const filters of [{ customer_email: 'ana' }, { customer_email: 'ana', type: 'sale' as const, from: '2026-10-01', to: '2026-11-01', cursor }]) {
    const detail = plan(filters);
    assert.match(
      detail,
      new RegExp(`USING INDEX ${IDX_ORDERS_BY_EMAIL} \\(merchant_id=\\? AND customer_email>\\? AND customer_email<\\?\\)`),
      JSON.stringify(filters),
    );
    assert.doesNotMatch(detail, /SCAN/, JSON.stringify(filters));
  }
});

test('plan: no client value is ever part of the SQL text', () => {
  const hostile = `x' OR 1=1 --`;
  const { sql, params } = buildOrderListQuery(hostile, { customer_email: hostile, cursor: { created_at: hostile, id: hostile } }, 26);
  assert.ok(!sql.includes('OR 1=1'));
  assert.equal(params.filter((p) => typeof p === 'string' && p.startsWith(hostile)).length, 5);
});
