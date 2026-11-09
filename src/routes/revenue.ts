import { Router } from 'express';
import { ordersDal } from '../dal/orders-dal.js';
import { validated } from '../validate-request.js';
import { parseRevenueQuery } from '../validation.js';

export const revenueRouter = Router();

/**
 * GET /api/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the net revenue (sales minus refunds) of the authenticated merchant
 * in the given date range.
 */
revenueRouter.get(
  '/',
  validated({ query: parseRevenueQuery }, ({ query, merchantId }, res) => {
    const total = ordersDal.netRevenueByMerchant(merchantId, query.from, query.to);
    res.json({
      merchant_id: merchantId,
      from: query.from,
      to: query.to,
      revenue_cents: total,
      revenue: total / 100,
    });
  }),
);
