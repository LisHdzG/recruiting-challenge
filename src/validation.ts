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

/** `GET /api/orders` */
export function parseOrderListQuery(query: unknown): DateRange & { limit: number } {
  return run((issues) => {
    const fields = isPlainObject(query) ? query : {};
    const range = readDateRange(fields, { required: false }, issues);
    const limit = readLimit(fields, { defaultValue: 100 }, issues);
    return { ...range, limit };
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
