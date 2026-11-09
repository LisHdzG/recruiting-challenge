import { MAX_TOTAL_AMOUNT } from '../validation.js';

/**
 * Money rules: what an order row is worth. The one place that decides it.
 *
 * - A **sale** adds its amount.
 * - A **refund** is stored with a positive amount and subtracts it, in the
 *   period the refund itself was created (it is not linked to a sale).
 * - Any other row is worth nothing and is not counted: a `type` that is not
 *   `sale` / `refund`, or an amount the API would reject today (not an
 *   integer, below 1, above the maximum). Such rows can only come from before
 *   input validation or from a direct write to the database. Ignoring them is
 *   deliberate: a refund stored as `-500` would otherwise *add* 500.
 *
 * These are SQL fragments over the `orders` columns. Every query that reports
 * money or counts orders uses them (`orders-dal.ts`, `routes/metrics.ts`), so
 * the endpoints cannot disagree. They contain no client input: the only
 * interpolated value is a numeric constant.
 */
const VALID_AMOUNT = `typeof(total_amount) = 'integer' AND total_amount BETWEEN 1 AND ${MAX_TOTAL_AMOUNT}`;

/** True (1) for a row that counts as a sale. */
export const IS_SALE = `(type = 'sale' AND ${VALID_AMOUNT})`;

/** True (1) for a row that counts as a refund. */
export const IS_REFUND = `(type = 'refund' AND ${VALID_AMOUNT})`;

/** The row's effect on revenue, in cents: +amount, -amount or 0. */
export const NET_AMOUNT = `(CASE WHEN ${IS_SALE} THEN total_amount WHEN ${IS_REFUND} THEN -total_amount ELSE 0 END)`;
