import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ordersDal } from '../dal/orders-dal.js';
import { validated } from '../validate-request.js';
import { parseOrderListQuery, parseOrderBody } from '../validation.js';

export const ordersRouter = Router();

ordersRouter.get(
  '/',
  validated({ query: parseOrderListQuery }, ({ query, merchantId }, res) => {
    res.json({ orders: ordersDal.listByMerchant(merchantId, query) });
  }),
);

ordersRouter.get(
  '/:id',
  validated({}, ({ params, merchantId }, res) => {
    const order = params.id ? ordersDal.getById(params.id, merchantId) : undefined;
    if (!order) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ order });
  }),
);

ordersRouter.post(
  '/',
  validated({ body: parseOrderBody }, ({ body, merchantId }, res) => {
    const order = ordersDal.create({
      id: randomUUID(),
      merchant_id: merchantId,
      customer_email: body.customer_email,
      total_amount: body.total_amount,
      type: body.type,
      status: 'completed',
    });
    res.status(201).json({ order });
  }),
);
