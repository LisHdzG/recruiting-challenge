import { db, IDX_ORDERS_BY_DATE, IDX_ORDERS_BY_EMAIL } from '../db.js';
import { encodeOrderCursor, type OrderListQuery, type OrderStatus } from '../validation.js';
import { NET_AMOUNT } from './order-rules.js';

export interface OrderRow {
  id: string;
  merchant_id: string;
  customer_email: string;
  total_amount: number;
  type: 'sale' | 'refund';
  status: OrderStatus;
  created_at: string;
}

/** Filters of the order list. All optional; see `parseOrderListQuery`. */
export type OrderListFilters = Partial<Omit<OrderListQuery, 'limit'>> & { limit?: number };

export interface OrderPage {
  orders: OrderRow[];
  /** Send it back as `cursor` to get the next page. `null` on the last page. */
  next_cursor: string | null;
}

/** The highest code point: `prefix + this` is the last text that starts with `prefix`. */
const LAST_CHARACTER = '\u{10FFFF}';

/**
 * The one query that lists orders. Every filter adds a fixed piece of SQL and
 * binds its value; no client input is ever part of the SQL text.
 *
 * Order: newest first, `id` as the tie-breaker, so the order is total and a
 * cursor always continues exactly where the previous page ended.
 *
 * The index is named on purpose, so the cost does not depend on what the
 * planner guesses (measured with 200,000 orders of one merchant):
 * - without an email filter, `idx_orders_merchant_created` gives the rows
 *   already in order and the query stops when the page is full;
 * - with one, `idx_orders_merchant_email` goes straight to the matching
 *   emails and sorts only those. Walking the date index instead reads every
 *   order of the merchant when few or none match.
 * Both indexes are created by `npm run migrate`, and the server does not start
 * without them. `test/order-search.test.ts` checks the plan.
 */
export function buildOrderListQuery(merchantId: string, filters: OrderListFilters, limit: number): { sql: string; params: Array<string | number> } {
  const where = ['merchant_id = ?'];
  const params: Array<string | number> = [merchantId];
  const add = (condition: string, ...values: Array<string | number>) => {
    where.push(condition);
    params.push(...values);
  };

  if (filters.customer_email !== undefined) {
    // "Starts with", ignoring ASCII case, written as a range so the index applies.
    add(
      'customer_email COLLATE NOCASE >= ? AND customer_email COLLATE NOCASE <= ?',
      filters.customer_email,
      filters.customer_email + LAST_CHARACTER,
    );
  }
  if (filters.from !== undefined && filters.to !== undefined) add('created_at >= ? AND created_at < ?', filters.from, filters.to);
  if (filters.type !== undefined) add('type = ?', filters.type);
  if (filters.status !== undefined) add('status = ?', filters.status);
  if (filters.min_amount !== undefined) add('total_amount >= ?', filters.min_amount);
  if (filters.max_amount !== undefined) add('total_amount <= ?', filters.max_amount);
  if (filters.cursor !== undefined) add('(created_at, id) < (?, ?)', filters.cursor.created_at, filters.cursor.id);

  const index = filters.customer_email !== undefined ? IDX_ORDERS_BY_EMAIL : IDX_ORDERS_BY_DATE;
  params.push(limit);
  return {
    sql: `SELECT * FROM orders INDEXED BY ${index}
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
    params,
  };
}

/**
 * Data-access layer for orders. Every query here filters by merchant id.
 *
 * Not every order query lives here: `routes/metrics.ts` runs its own, on a
 * separate read-only connection.
 */
export const ordersDal = {
  /** One page of the merchant's orders, newest first, narrowed by the filters. */
  listByMerchant(merchantId: string, filters: OrderListFilters = {}): OrderPage {
    const limit = filters.limit ?? 100;
    // One row more than the page: its presence says there is a next page, without counting.
    const { sql, params } = buildOrderListQuery(merchantId, filters, limit + 1);
    const rows = db.prepare(sql).all(...params) as OrderRow[];
    const orders = rows.slice(0, limit);
    const last = orders.at(-1);
    return {
      orders,
      next_cursor: rows.length > limit && last ? encodeOrderCursor({ created_at: last.created_at, id: last.id }) : null,
    };
  },

  getById(id: string, merchantId: string): OrderRow | undefined {
    return db
      .prepare(`SELECT * FROM orders WHERE id = ? AND merchant_id = ?`)
      .get(id, merchantId) as OrderRow | undefined;
  },

  create(order: Omit<OrderRow, 'created_at'>): OrderRow {
    // The date is written here, in the one format, not left to the column default:
    // a database created before the migration still has the old default.
    db.prepare(
      `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(order.id, order.merchant_id, order.customer_email, order.total_amount, order.type, order.status, new Date().toISOString());
    return this.getById(order.id, order.merchant_id)!;
  },

  /**
   * Net revenue of a merchant in a date range: sales minus refunds, in cents.
   * Can be negative (a period with more refunded than sold). What a row is
   * worth is decided in `order-rules.ts`. Used by the revenue endpoint.
   */
  netRevenueByMerchant(merchantId: string, from: string, to: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(${NET_AMOUNT}), 0) AS total
         FROM orders
         WHERE merchant_id = ? AND created_at >= ? AND created_at < ?`,
      )
      .get(merchantId, from, to) as { total: number };
    return row.total;
  },
};
