import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';

/**
 * Merchant API keys. A key is shown once when it is issued; the database only
 * keeps its SHA-256 hash, so a copy of the database cannot be used to sign in.
 */

export function generateApiKey(): string {
  return `mk_${randomBytes(24).toString('base64url')}`;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Stores a fresh key for the merchant (replacing any previous one) and returns it in plain text. */
export function issueApiKey(merchantId: string): string {
  const key = generateApiKey();
  db.prepare(`UPDATE merchants SET api_key_hash = ? WHERE id = ?`).run(hashApiKey(key), merchantId);
  return key;
}

export function findMerchantIdByApiKey(key: string): string | undefined {
  const row = db
    .prepare(`SELECT id FROM merchants WHERE api_key_hash = ?`)
    .get(hashApiKey(key)) as { id: string } | undefined;
  return row?.id;
}
