import { Router } from 'express';
import Database from 'better-sqlite3';
import { validated } from '../validate-request.js';
import { parseTopCustomersQuery } from '../validation.js';

const DB_PATH = process.env.DB_PATH ?? 'data/dashboard.db';
const metricsDb = new Database(DB_PATH, { readonly: true });

export const metricsRouter = Router();

/**
 * GET /api/metrics/summary
 *
 * Returns dashboard summary stats for the current merchant.
 */
metricsRouter.get('/summary', validated({}, ({ merchantId }, res) => {
  const totalOrdersRow = metricsDb
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE merchant_id = ?`)
    .get(merchantId) as { n: number };

  const totalCustomersRow = metricsDb
    .prepare(
      `SELECT COUNT(DISTINCT customer_email) AS n FROM orders WHERE merchant_id = ?`,
    )
    .get(merchantId) as { n: number };

  const avgOrderRow = metricsDb
    .prepare(
      `SELECT COALESCE(AVG(total_amount), 0) AS avg FROM orders WHERE merchant_id = ?`,
    )
    .get(merchantId) as { avg: number };

  res.json({
    merchant_id: merchantId,
    total_orders: totalOrdersRow.n,
    unique_customers: totalCustomersRow.n,
    avg_order_value_cents: Math.round(avgOrderRow.avg),
  });
}));

metricsRouter.get('/top-customers', validated({ query: parseTopCustomersQuery }, ({ query, merchantId }, res) => {

  const rows = metricsDb
    .prepare(
      `SELECT customer_email, COUNT(*) AS order_count, SUM(total_amount) AS total_spent
       FROM orders
       WHERE merchant_id = ?
       GROUP BY customer_email
       ORDER BY total_spent DESC
       LIMIT ?`,
    )
    .all(merchantId, query.limit) as Array<{ customer_email: string; order_count: number; total_spent: number }>;

  res.json({ customers: rows });
}));
