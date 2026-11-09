import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  MAX_TOTAL_AMOUNT,
  encodeOrderCursor,
  findNestedFields,
  isCalendarDate,
  parseDateRange,
  parseLimit,
  parseOrderBody,
  parseOrderListQuery,
  parseRevenueQuery,
  parseTopCustomersQuery,
} from '../src/validation.js';

/** Runs the parser and returns the fields it rejected, in order. */
function rejectedFields(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ValidationError, `expected a ValidationError, got ${String(err)}`);
    assert.ok(err.details.every((d) => d.field && d.issue), 'every issue names a field and says why');
    return err.details.map((d) => d.field);
  }
  return [];
}

// --- shape ------------------------------------------------------------------

test('shape: arrays and objects are reported by field name, single values are not', () => {
  assert.deepEqual(
    findNestedFields({ a: 'x', b: ['x'], c: { k: 1 }, d: [], e: null, f: 5, g: true }).map((i) => i.field),
    ['b', 'c', 'd'],
  );
  assert.deepEqual(findNestedFields({}), []);
  assert.deepEqual(findNestedFields(undefined), []);
});

// --- dates ------------------------------------------------------------------

test('dates: only real calendar dates written as YYYY-MM-DD', () => {
  for (const ok of ['2026-11-06', '2024-02-29', '1999-12-31']) assert.equal(isCalendarDate(ok), true, ok);
  for (const bad of [
    'hola', '', ' ', '2026-1-1', '01/01/2026', '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10',
    '2026-11-06T00:00:00Z', '2026-11-06 00:00:00', ' 2026-11-06', '2026-11-06 ', 20261106, null, ['2026-11-06'],
  ]) {
    assert.equal(isCalendarDate(bad), false, JSON.stringify(bad));
  }
});

test('dates: a valid range comes back unchanged', () => {
  assert.deepEqual(parseDateRange({ from: '2026-11-06', to: '2026-11-07' }, { required: true }), {
    from: '2026-11-06',
    to: '2026-11-07',
  });
});

test('dates: required range rejects each missing side', () => {
  assert.deepEqual(rejectedFields(() => parseDateRange({}, { required: true })), ['from', 'to']);
  assert.deepEqual(rejectedFields(() => parseDateRange({ from: '2026-11-06' }, { required: true })), ['to']);
  assert.deepEqual(rejectedFields(() => parseDateRange({ to: '2026-11-06' }, { required: true })), ['from']);
});

test('dates: optional range may be left out, but never half of it', () => {
  assert.deepEqual(parseDateRange({}, { required: false }), {});
  assert.deepEqual(parseDateRange(undefined, { required: false }), {});
  assert.deepEqual(rejectedFields(() => parseDateRange({ from: '2099-01-01' }, { required: false })), ['to']);
  assert.deepEqual(rejectedFields(() => parseDateRange({ to: '2000-01-01' }, { required: false })), ['from']);
});

test('dates: malformed values are rejected on the side that is wrong', () => {
  assert.deepEqual(rejectedFields(() => parseDateRange({ from: 'hola', to: 'adios' }, { required: true })), ['from', 'to']);
  assert.deepEqual(rejectedFields(() => parseDateRange({ from: '2026-01-01', to: '2026-02-30' }, { required: true })), ['to']);
  assert.deepEqual(rejectedFields(() => parseDateRange({ from: '', to: '' }, { required: false })), ['from', 'to']);
  assert.deepEqual(
    rejectedFields(() => parseDateRange({ from: ['2026-01-01', '2025-01-01'], to: '2027-01-01' }, { required: true })),
    ['from'],
  );
});

test('dates: from must be earlier than to (to is exclusive, so equal is empty)', () => {
  assert.deepEqual(rejectedFields(() => parseDateRange({ from: '2026-12-01', to: '2026-01-01' }, { required: true })), ['to']);
  assert.deepEqual(rejectedFields(() => parseDateRange({ from: '2026-11-06', to: '2026-11-06' }, { required: true })), ['to']);
});

// --- limit ------------------------------------------------------------------

test('limit: default when absent, whole number inside the range otherwise', () => {
  assert.equal(parseLimit({}, { defaultValue: 100 }), 100);
  assert.equal(parseLimit({}, { defaultValue: 5 }), 5);
  assert.equal(parseLimit({ limit: '1' }, { defaultValue: 100 }), 1);
  assert.equal(parseLimit({ limit: '10' }, { defaultValue: 100 }), 10);
  assert.equal(parseLimit({ limit: '100' }, { defaultValue: 100 }), 100);
});

test('limit: everything else is rejected', () => {
  for (const bad of [
    '0', '101', '-1', '-5', '', ' ', 'abc', '1.5', '1e2', '0x3', ' 3 ', '+3', 'Infinity', 'true',
    '99999999999999999999', 3, null, ['3'], ['3', '1'], { a: '3' },
  ]) {
    assert.deepEqual(rejectedFields(() => parseLimit({ limit: bad }, { defaultValue: 100 })), ['limit'], JSON.stringify(bad));
  }
});

// --- per-endpoint parsers ----------------------------------------------------

test('order list query: defaults, and every problem reported at once', () => {
  assert.deepEqual(parseOrderListQuery({}), { limit: 100 });
  assert.deepEqual(parseOrderListQuery({ from: '2026-01-01', to: '2026-02-01', limit: '10' }), {
    from: '2026-01-01',
    to: '2026-02-01',
    limit: 10,
  });
  assert.deepEqual(rejectedFields(() => parseOrderListQuery({ from: '2099-01-01', limit: '-1' })), ['to', 'limit']);
});

test('revenue query: both dates are required', () => {
  assert.deepEqual(parseRevenueQuery({ from: '2026-01-01', to: '2027-01-01' }), { from: '2026-01-01', to: '2027-01-01' });
  assert.deepEqual(rejectedFields(() => parseRevenueQuery({})), ['from', 'to']);
});

test('top customers query: default 5', () => {
  assert.deepEqual(parseTopCustomersQuery({}), { limit: 5 });
  assert.deepEqual(parseTopCustomersQuery({ limit: '3' }), { limit: 3 });
  assert.deepEqual(rejectedFields(() => parseTopCustomersQuery({ limit: '0' })), ['limit']);
});

// --- order body --------------------------------------------------------------

const valid = { customer_email: 'ana@example.com', total_amount: 5000 };

test('order body: a valid order, with type defaulting to sale', () => {
  assert.deepEqual(parseOrderBody(valid), { ...valid, type: 'sale' });
  assert.deepEqual(parseOrderBody({ ...valid, type: 'sale' }), { ...valid, type: 'sale' });
  assert.deepEqual(parseOrderBody({ ...valid, type: 'refund' }), { ...valid, type: 'refund' });
  assert.equal(parseOrderBody({ ...valid, total_amount: 1 }).total_amount, 1);
  assert.equal(parseOrderBody({ ...valid, total_amount: MAX_TOTAL_AMOUNT }).total_amount, MAX_TOTAL_AMOUNT);
});

test('order body: fields the API does not take are ignored, not stored', () => {
  assert.deepEqual(
    parseOrderBody({ ...valid, id: 'mine', merchant_id: 'm_other', status: 'hack', created_at: '1999-01-01' }),
    { ...valid, type: 'sale' },
  );
});

test('order body: the body itself must be a JSON object', () => {
  for (const bad of [undefined, null, 'hola', 5, [], [valid]]) {
    assert.deepEqual(rejectedFields(() => parseOrderBody(bad)), ['body'], JSON.stringify(bad));
  }
});

test('order body: missing fields are all reported', () => {
  assert.deepEqual(rejectedFields(() => parseOrderBody({})), ['customer_email', 'total_amount']);
});

test('order body: total_amount must be an integer between 1 and the maximum', () => {
  for (const bad of [
    0, -1, -500, 12.5, 1e30, Infinity, -Infinity, NaN, MAX_TOTAL_AMOUNT + 1, 9007199254740993,
    '500', '', null, true, [500], { cents: 500 },
  ]) {
    assert.deepEqual(rejectedFields(() => parseOrderBody({ ...valid, total_amount: bad })), ['total_amount'], String(bad));
  }
});

test('order body: customer_email must be text shaped like an email', () => {
  for (const bad of [
    '', '   ', 'no-es-un-email', 'a@b', '@x.com', 'a@', 'a b@x.com', ' a@x.com', 'a@x.com ', 'a@@x.com',
    '<b>hola</b>@x.com', '<script>@x.com', 'a>b@x.com', 'a@<x>.com', 'a@x.<com>', 'ana<@x.com',
    `${'a'.repeat(250)}@x.com`, 123, true, null, [], ['a@x.com'], { a: 1 },
  ]) {
    assert.deepEqual(rejectedFields(() => parseOrderBody({ ...valid, customer_email: bad })), ['customer_email'], JSON.stringify(bad));
  }
  // 254 characters is still accepted
  const longest = `${'a'.repeat(248)}@x.com`;
  assert.equal(longest.length, 254);
  assert.equal(parseOrderBody({ ...valid, customer_email: longest }).customer_email, longest);
});

test('order body: type is sale, refund or absent', () => {
  for (const bad of ['banana', '', 'SALE', 'Refund', ' sale', 5, null, true, [], ['sale'], {}]) {
    assert.deepEqual(rejectedFields(() => parseOrderBody({ ...valid, type: bad })), ['type'], JSON.stringify(bad));
  }
});

test('order body: every invalid field is reported in one error', () => {
  assert.deepEqual(
    rejectedFields(() => parseOrderBody({ customer_email: [], total_amount: 777.5, type: ['a', 'b'] })),
    ['customer_email', 'total_amount', 'type'],
  );
});

// --- order list filters -------------------------------------------------------

test('order filters: every filter left out means no filter, and the default limit', () => {
  assert.deepEqual(parseOrderListQuery({}), { limit: 100 });
  assert.deepEqual(parseOrderListQuery(undefined), { limit: 100 });
});

test('order filters: valid values come back typed', () => {
  const cursor = encodeOrderCursor({ created_at: '2026-11-06T02:28:37.000Z', id: 'abc' });
  assert.deepEqual(
    parseOrderListQuery({
      customer_email: 'Ana', type: 'refund', status: 'completed', from: '2026-01-01', to: '2026-02-01',
      min_amount: '100', max_amount: '5000', limit: '25', cursor,
    }),
    {
      customer_email: 'Ana', type: 'refund', status: 'completed', from: '2026-01-01', to: '2026-02-01',
      min_amount: 100, max_amount: 5000, limit: 25, cursor: { created_at: '2026-11-06T02:28:37.000Z', id: 'abc' },
    },
  );
  // The email filter is the start of an email: it does not have to look like one, and is not trimmed.
  assert.equal(parseOrderListQuery({ customer_email: ' a%_' }).customer_email, ' a%_');
  assert.deepEqual(parseOrderListQuery({ min_amount: '700' }), { min_amount: 700, limit: 100 });
  assert.deepEqual(parseOrderListQuery({ max_amount: '700' }), { max_amount: 700, limit: 100 });
  assert.deepEqual(parseOrderListQuery({ min_amount: '700', max_amount: '700' }), { min_amount: 700, max_amount: 700, limit: 100 });
});

test('order filters: status accepts only the statuses that exist', () => {
  assert.equal(parseOrderListQuery({ status: 'completed' }).status, 'completed');
  for (const bad of ['pending', 'cancelled', 'refunded', 'Completed', '', ' completed']) {
    assert.deepEqual(rejectedFields(() => parseOrderListQuery({ status: bad })), ['status'], bad);
  }
});

test('order filters: type accepts only sale or refund', () => {
  for (const bad of ['banana', 'SALE', '', 'sale ', 'sale,refund']) {
    assert.deepEqual(rejectedFields(() => parseOrderListQuery({ type: bad })), ['type'], bad);
  }
});

test('order filters: amounts are whole cents within the same limits as an order', () => {
  for (const field of ['min_amount', 'max_amount']) {
    for (const bad of ['0', '-1', '12.5', '1e3', 'abc', '', ' 5', '0x10', String(MAX_TOTAL_AMOUNT + 1), 500]) {
      assert.deepEqual(rejectedFields(() => parseOrderListQuery({ [field]: bad })), [field], `${field}=${JSON.stringify(bad)}`);
    }
    assert.equal((parseOrderListQuery({ [field]: String(MAX_TOTAL_AMOUNT) }) as unknown as Record<string, unknown>)[field], MAX_TOTAL_AMOUNT);
  }
  assert.deepEqual(rejectedFields(() => parseOrderListQuery({ min_amount: '500', max_amount: '100' })), ['max_amount']);
});

test('order filters: customer_email is text of 1 to 254 characters', () => {
  assert.deepEqual(rejectedFields(() => parseOrderListQuery({ customer_email: '' })), ['customer_email']);
  assert.deepEqual(rejectedFields(() => parseOrderListQuery({ customer_email: 'a'.repeat(255) })), ['customer_email']);
  assert.deepEqual(rejectedFields(() => parseOrderListQuery({ customer_email: 5 })), ['customer_email']);
  assert.equal(parseOrderListQuery({ customer_email: 'a'.repeat(254) }).customer_email?.length, 254);
});

test('order filters: a cursor is accepted only in the shape this API produces', () => {
  const b64 = (text: string) => Buffer.from(text).toString('base64url');
  for (const bad of ['', 'abc', '!!', 'a b', b64('{"a":1}'), b64('[]'), b64('["x"]'), b64('["x",1]'), b64('["x","y","z"]'), b64('null'), 'A'.repeat(513), 5]) {
    assert.deepEqual(rejectedFields(() => parseOrderListQuery({ cursor: bad })), ['cursor'], JSON.stringify(bad));
  }
  const odd = { created_at: 'not a date', id: 'u|"\\' };
  assert.deepEqual(parseOrderListQuery({ cursor: encodeOrderCursor(odd) }).cursor, odd);
});

test('order filters: all the failures are reported together, in a fixed order', () => {
  assert.deepEqual(
    rejectedFields(() => parseOrderListQuery({ customer_email: '', type: 'x', status: 'y', to: '2026-01-01', min_amount: 'z', max_amount: '0', limit: '0', cursor: '!' })),
    ['customer_email', 'type', 'status', 'from', 'min_amount', 'max_amount', 'limit', 'cursor'],
  );
});
