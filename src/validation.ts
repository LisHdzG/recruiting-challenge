/**
 * Input validation rules.
 *
 * Everything a client sends (query string and JSON body) is untrusted. The
 * functions here turn that raw input into typed values or throw a
 * `ValidationError` listing every field that failed. They are pure: no
 * Express, no database, so they can be tested on their own.
 *
 * Routes never read the raw request. They name one of the `parse*` functions
 * in `validated()` (see `validate-request.ts`) and receive its result.
 */

export interface ValidationIssue {
  field: string;
  issue: string;
}

export class ValidationError extends Error {
  readonly details: ValidationIssue[];

  constructor(details: ValidationIssue[]) {
    super(`invalid request: ${details.map((d) => `${d.field} ${d.issue}`).join('; ')}`);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export const MAX_LIMIT = 100;
export const MAX_TOTAL_AMOUNT = 100_000_000; // cents
export const MAX_EMAIL_LENGTH = 254;
export const ORDER_TYPES = ['sale', 'refund'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
/** Every status an order can have. Nothing in the system changes it, so there is one. */
export const ORDER_STATUSES = ['completed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const MAX_CURSOR_LENGTH = 512;

type Fields = Record<string, unknown>;

function isPlainObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Runs a parser that reports into `issues` and throws if it reported anything. */
function run<T>(build: (issues: ValidationIssue[]) => T): T {
  const issues: ValidationIssue[] = [];
  const value = build(issues);
  if (issues.length > 0) throw new ValidationError(issues);
  return value;
}

// ---------------------------------------------------------------------------
// Shape: no field may be an array or an object, anywhere.
// ---------------------------------------------------------------------------

/**
 * Lists the fields of a query string or JSON body whose value is an array or
 * an object. Express turns `?limit=1&limit=2` and `?limit[]=1` into arrays and
 * `?limit[a]=1` into an object, and the SQLite driver spreads an array over
 * several bind parameters, so none of them may get past the entrance.
 */
export function findNestedFields(source: unknown): ValidationIssue[] {
  if (!isPlainObject(source)) return [];
  return Object.keys(source)
    .filter((field) => typeof source[field] === 'object' && source[field] !== null)
    .map((field) => ({ field, issue: 'must be a single value, not an array or an object' }));
}

// ---------------------------------------------------------------------------
// Dates: the one rule shared by every endpoint that takes a range.
// ---------------------------------------------------------------------------

export interface DateRange {
  from?: string;
  to?: string;
}

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** True for a date that exists in the calendar, written exactly as YYYY-MM-DD. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_FORMAT.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function readDateRange(fields: Fields, opts: { required: boolean }, issues: ValidationIssue[]): DateRange {
  const { from, to } = fields;
  const before = issues.length;

  for (const [field, value, other] of [['from', from, 'to'], ['to', to, 'from']] as const) {
    if (value === undefined) {
      if (opts.required) issues.push({ field, issue: 'is required (YYYY-MM-DD)' });
      else if (fields[other] !== undefined) issues.push({ field, issue: `is required when \`${other}\` is sent (YYYY-MM-DD)` });
    } else if (!isCalendarDate(value)) {
      issues.push({ field, issue: 'must be a real calendar date in YYYY-MM-DD format' });
    }
  }
  if (issues.length > before || from === undefined || to === undefined) return {};

  // Same fixed format on both sides, so comparing the text compares the dates.
  if ((from as string) >= (to as string)) {
    issues.push({ field: 'to', issue: 'must be later than `from` (`to` is exclusive)' });
    return {};
  }
  return { from: from as string, to: to as string };
}

/**
 * `from` / `to` of a query string. Days are UTC; `from` is inclusive and `to`
 * exclusive. Only YYYY-MM-DD is accepted: a date-only bound compares correctly
 * against both timestamp formats stored in `orders.created_at`, a bound with a
 * time does not.
 *
 * With `required: false` the range may be left out, but never half of it.
 */
export function parseDateRange(query: unknown, opts: { required: boolean }): DateRange {
  return run((issues) => readDateRange(isPlainObject(query) ? query : {}, opts, issues));
}

// ---------------------------------------------------------------------------
// limit
// ---------------------------------------------------------------------------

function readLimit(fields: Fields, opts: { defaultValue: number; max?: number }, issues: ValidationIssue[]): number {
  const max = opts.max ?? MAX_LIMIT;
  const raw = fields.limit;
  if (raw === undefined) return opts.defaultValue;
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= 1 && value <= max)) {
    issues.push({ field: 'limit', issue: `must be a whole number between 1 and ${max}` });
    return opts.defaultValue;
  }
  return value;
}

export function parseLimit(query: unknown, opts: { defaultValue: number; max?: number }): number {
  return run((issues) => readLimit(isPlainObject(query) ? query : {}, opts, issues));
}

// ---------------------------------------------------------------------------
// One parser per endpoint input. Routes use these, nothing else.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Order list filters
// ---------------------------------------------------------------------------

/** A filter that must be one of a fixed list of words. Left out means "any". */
function readOneOf<T extends string>(fields: Fields, field: string, allowed: readonly T[], issues: ValidationIssue[]): T | undefined {
  const raw = fields[field];
  if (raw === undefined) return undefined;
  if (!allowed.includes(raw as T)) {
    issues.push({ field, issue: `must be ${allowed.map((v) => `"${v}"`).join(' or ')} (or left out)` });
    return undefined;
  }
  return raw as T;
}

/**
 * `customer_email` as a filter: the start of an email, not a whole one, so the
 * email format rule does not apply. Any text of 1 to 254 characters; it is
 * compared as text, never used as a pattern.
 */
function readEmailPrefix(fields: Fields, issues: ValidationIssue[]): string | undefined {
  const raw = fields.customer_email;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > MAX_EMAIL_LENGTH) {
    issues.push({ field: 'customer_email', issue: `must be text of 1 to ${MAX_EMAIL_LENGTH} characters: the start of an email` });
    return undefined;
  }
  return raw;
}

function readAmount(fields: Fields, field: string, issues: ValidationIssue[]): number | undefined {
  const raw = fields[field];
  if (raw === undefined) return undefined;
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= 1 && value <= MAX_TOTAL_AMOUNT)) {
    issues.push({ field, issue: `must be a whole number of cents between 1 and ${MAX_TOTAL_AMOUNT}` });
    return undefined;
  }
  return value;
}

function readAmountRange(fields: Fields, issues: ValidationIssue[]): { min_amount?: number; max_amount?: number } {
  const min_amount = readAmount(fields, 'min_amount', issues);
  const max_amount = readAmount(fields, 'max_amount', issues);
  if (min_amount !== undefined && max_amount !== undefined && min_amount > max_amount) {
    issues.push({ field: 'max_amount', issue: 'must not be lower than `min_amount`' });
    return {};
  }
  return {
    ...(min_amount !== undefined && { min_amount }),
    ...(max_amount !== undefined && { max_amount }),
  };
}

/** Where a page of orders ended: the last row's sort key. */
export interface OrderCursor {
  created_at: string;
  id: string;
}

/**
 * The cursor a client sends back to get the next page. Opaque to the client:
 * base64url of `[created_at, id]`. It only says where to continue; the
 * merchant always comes from the API key, so a cursor made up by a client
 * cannot reach another merchant's orders.
 */
export function encodeOrderCursor(last: OrderCursor): string {
  return Buffer.from(JSON.stringify([last.created_at, last.id]), 'utf8').toString('base64url');
}

function readCursor(fields: Fields, issues: ValidationIssue[]): OrderCursor | undefined {
  const raw = fields.cursor;
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && raw.length <= MAX_CURSOR_LENGTH && /^[A-Za-z0-9_-]+$/.test(raw)) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (Array.isArray(decoded) && decoded.length === 2 && typeof decoded[0] === 'string' && typeof decoded[1] === 'string') {
        return { created_at: decoded[0], id: decoded[1] };
      }
    } catch {}
  }
  issues.push({ field: 'cursor', issue: 'must be a `next_cursor` value returned by this endpoint' });
  return undefined;
}

export interface OrderListQuery extends DateRange {
  /** Start of the customer email, compared without regard to case. */
  customer_email?: string;
  type?: OrderType;
  status?: OrderStatus;
  /** Cents, inclusive. */
  min_amount?: number;
  /** Cents, inclusive. */
  max_amount?: number;
  cursor?: OrderCursor;
  limit: number;
}

/** `GET /api/orders` */
export function parseOrderListQuery(query: unknown): OrderListQuery {
  return run((issues) => {
    const fields = isPlainObject(query) ? query : {};
    const customer_email = readEmailPrefix(fields, issues);
    const type = readOneOf(fields, 'type', ORDER_TYPES, issues);
    const status = readOneOf(fields, 'status', ORDER_STATUSES, issues);
    const range = readDateRange(fields, { required: false }, issues);
    const amounts = readAmountRange(fields, issues);
    const limit = readLimit(fields, { defaultValue: 100 }, issues);
    const cursor = readCursor(fields, issues);
    return {
      ...(customer_email !== undefined && { customer_email }),
      ...(type !== undefined && { type }),
      ...(status !== undefined && { status }),
      ...range,
      ...amounts,
      ...(cursor !== undefined && { cursor }),
      limit,
    };
  });
}

/** `GET /api/revenue` */
export function parseRevenueQuery(query: unknown): { from: string; to: string } {
  const range = parseDateRange(query, { required: true });
  return { from: range.from!, to: range.to! };
}

/** `GET /api/metrics/top-customers` */
export function parseTopCustomersQuery(query: unknown): { limit: number } {
  return { limit: parseLimit(query, { defaultValue: 5 }) };
}

export interface NewOrderInput {
  customer_email: string;
  total_amount: number;
  type: OrderType;
}

const EMAIL_FORMAT = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** `POST /api/orders` */
export function parseOrderBody(body: unknown): NewOrderInput {
  return run((issues) => {
    if (!isPlainObject(body)) {
      issues.push({ field: 'body', issue: 'must be a JSON object' });
      return { customer_email: '', total_amount: 0, type: 'sale' as OrderType };
    }
    const { customer_email, total_amount, type } = body;

    if (customer_email === undefined) {
      issues.push({ field: 'customer_email', issue: 'is required' });
    } else if (
      typeof customer_email !== 'string' ||
      customer_email.length > MAX_EMAIL_LENGTH ||
      !EMAIL_FORMAT.test(customer_email)
    ) {
      issues.push({
        field: 'customer_email',
        issue: `must be an email address like name@example.com, without spaces, < or >, of at most ${MAX_EMAIL_LENGTH} characters`,
      });
    }

    if (total_amount === undefined) {
      issues.push({ field: 'total_amount', issue: 'is required' });
    } else if (
      typeof total_amount !== 'number' ||
      !Number.isInteger(total_amount) ||
      total_amount < 1 ||
      total_amount > MAX_TOTAL_AMOUNT
    ) {
      issues.push({
        field: 'total_amount',
        issue: `must be an integer number of cents between 1 and ${MAX_TOTAL_AMOUNT}`,
      });
    }

    if (type !== undefined && !ORDER_TYPES.includes(type as OrderType)) {
      issues.push({ field: 'type', issue: 'must be "sale" or "refund" (or left out, which means "sale")' });
    }

    return {
      customer_email: customer_email as string,
      total_amount: total_amount as number,
      type: (type ?? 'sale') as OrderType,
    };
  });
}
