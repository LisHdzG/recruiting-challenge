import { Router } from 'express';
import Database from 'better-sqlite3';
import { validated } from '../validate-request.js';
import { parseTopCustomersQuery } from '../validation.js';
import { IS_SALE, NET_AMOUNT } from '../dal/order-rules.js';

const DB_PATH = process.env.DB_PATH ?? 'data/dashboard.db';
const metricsDb = new Database(DB_PATH, { readonly: true });

export const metricsRouter = Router();

/**
 * GET /api/metrics/summary
 *
 * Dashboard summary for the current merchant. Counts sales only: a refund is
 * not an order, a customer or part of the average (see `dal/order-rules.ts`).
 * One query, so the three figures always come from the same rows.
 */
metricsRouter.get('/summary', validated({}, ({ merchantId }, res) => {
  const row = metricsDb
    .prepare(
      `SELECT COALESCE(SUM(${IS_SALE}), 0) AS total_orders,
              COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN customer_email END) AS unique_customers,
              COALESCE(AVG(CASE WHEN ${IS_SALE} THEN total_amount END), 0) AS avg_sale
       FROM orders
       WHERE merchant_id = ?`,
    )
    .get(merchantId) as { total_orders: number; unique_customers: number; avg_sale: number };

  res.json({
    merchant_id: merchantId,
    total_orders: row.total_orders,
    unique_customers: row.unique_customers,
    avg_order_value_cents: Math.round(row.avg_sale),
  });
}));

/**
 * GET /api/metrics/top-customers
 *
 * Customers ranked by net spent (sales minus refunds). `order_count` is their
 * number of sales. A customer with no sale, or whose refunds cancel their
 * sales (net of zero or less), is left out.
 */
metricsRouter.get('/top-customers', validated({ query: parseTopCustomersQuery }, ({ query, merchantId }, res) => {
  const rows = metricsDb
    .prepare(
      `SELECT customer_email, SUM(${IS_SALE}) AS order_count, SUM(${NET_AMOUNT}) AS total_spent
       FROM orders
       WHERE merchant_id = ?
       GROUP BY customer_email
       HAVING SUM(${IS_SALE}) > 0 AND SUM(${NET_AMOUNT}) > 0
       ORDER BY total_spent DESC, customer_email ASC
       LIMIT ?`,
    )
    .all(merchantId, query.limit) as Array<{ customer_email: string; order_count: number; total_spent: number }>;

  res.json({ customers: rows });
}));
