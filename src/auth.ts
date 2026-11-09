import type { Request, Response, NextFunction } from 'express';
import { findMerchantIdByApiKey } from './api-keys.js';

declare global {
  namespace Express {
    interface Request {
      merchantId?: string;
    }
  }
}

/**
 * Clients send `Authorization: Bearer <api key>`. The merchant is looked up
 * from the key in the database; nothing the client sends is trusted as a
 * merchant id.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.header('Authorization') ?? '');
  const merchantId = match ? findMerchantIdByApiKey(match[1]!) : undefined;
  if (!merchantId) {
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
    return;
  }
  req.merchantId = merchantId;
  next();
}
