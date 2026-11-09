import { pathToFileURL } from 'node:url';
import { db, initSchema, hasApiKeyColumn, migrateOrders, type OrderMigrationResult } from '../db.js';
import { issueApiKey } from '../api-keys.js';

export interface MigrationResult {
  /** Keys issued by this run, in plain text. They cannot be read back later. */
  issued: Array<{ merchantId: string; apiKey: string }>;
  orders: OrderMigrationResult;
}

/**
 * Brings an older database up to date. Safe to run more than once.
 *
 * 1. API keys: adds the `api_key_hash` column and issues a key to every
 *    merchant that has none. Merchants that already have a key keep it.
 * 2. Orders: rewrites `created_at` to the one format and creates the indexes
 *    of the order list (see `migrateOrders` in `db.ts`).
 */
export function migrate(): MigrationResult {
  initSchema();
  return db.transaction(() => {
    if (!hasApiKeyColumn()) {
      db.exec(`ALTER TABLE merchants ADD COLUMN api_key_hash TEXT`);
      db.exec(`CREATE UNIQUE INDEX idx_merchants_api_key_hash ON merchants(api_key_hash)`);
    }
    const pending = db
      .prepare(`SELECT id FROM merchants WHERE api_key_hash IS NULL ORDER BY id`)
      .all() as Array<{ id: string }>;
    const issued = pending.map(({ id }) => ({ merchantId: id, apiKey: issueApiKey(id) }));
    return { issued, orders: migrateOrders() };
  })();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { issued, orders } = migrate();
  for (const { merchantId, apiKey } of issued) {
    console.log(`[migrate] API key for ${merchantId}: ${apiKey}`);
  }
  console.log(
    issued.length > 0
      ? '[migrate] Keys are shown only once. Copy them now.'
      : '[migrate] API keys: every merchant already has one',
  );
  console.log(`[migrate] created_at: ${orders.datesRewritten} orders rewritten to the one format`);
  if (orders.datesUnreadable > 0) {
    console.log(`[migrate] created_at: ${orders.datesUnreadable} orders have a value that is not a date; left as they are`);
  }
  console.log(
    orders.indexesCreated.length > 0
      ? `[migrate] indexes created: ${orders.indexesCreated.join(', ')}`
      : '[migrate] indexes: already in place',
  );
}
