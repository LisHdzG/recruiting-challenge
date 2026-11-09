import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? 'data/dashboard.db';

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key_hash TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      customer_email TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'sale',
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  `);
}

/** False for a database created before API keys existed. `npm run migrate` fixes it. */
export function hasApiKeyColumn(): boolean {
  const columns = db.prepare(`PRAGMA table_info(merchants)`).all() as Array<{ name: string }>;
  return columns.some((c) => c.name === 'api_key_hash');
}

// ---------------------------------------------------------------------------
// Order storage: one timestamp format and the indexes the order list needs.
// ---------------------------------------------------------------------------

/**
 * The one format of `orders.created_at`: UTC, `2026-11-06T02:28:37.000Z`.
 * Text in this format sorts in time order, which the order list and its
 * cursor depend on. `new Date().toISOString()` produces it.
 */
const ISO_TIMESTAMP_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z';
const TO_ISO_TIMESTAMP = `strftime('%Y-%m-%dT%H:%M:%fZ', created_at)`;

/** Newest-first listing of a merchant's orders, with `id` as the tie-breaker. */
export const IDX_ORDERS_BY_DATE = 'idx_orders_merchant_created';
/** Search by the start of the customer email, ignoring case. */
export const IDX_ORDERS_BY_EMAIL = 'idx_orders_merchant_email';

const ORDER_INDEXES: Record<string, string> = {
  [IDX_ORDERS_BY_DATE]: `CREATE INDEX ${IDX_ORDERS_BY_DATE} ON orders(merchant_id, created_at, id)`,
  [IDX_ORDERS_BY_EMAIL]: `CREATE INDEX ${IDX_ORDERS_BY_EMAIL} ON orders(merchant_id, customer_email COLLATE NOCASE)`,
};

function missingOrderIndexes(): string[] {
  const existing = new Set((db.prepare(`PRAGMA index_list(orders)`).all() as Array<{ name: string }>).map((i) => i.name));
  return Object.keys(ORDER_INDEXES).filter((name) => !existing.has(name));
}

export interface OrderMigrationResult {
  /** Rows whose `created_at` was rewritten to the one format. Same instant, new text. */
  datesRewritten: number;
  /** Rows whose `created_at` is not a date SQLite can read. Left as they are. */
  datesUnreadable: number;
  indexesCreated: string[];
}

/**
 * Brings the `orders` table to what the order list expects: every readable
 * `created_at` in the one format, and both indexes. Runs from `npm run migrate`
 * and at the end of `npm run seed`, never when the server starts. Safe to run
 * again.
 */
export function migrateOrders(): OrderMigrationResult {
  return db.transaction(() => {
    const datesRewritten = db
      .prepare(
        `UPDATE orders SET created_at = ${TO_ISO_TIMESTAMP}
         WHERE created_at NOT GLOB ? AND ${TO_ISO_TIMESTAMP} IS NOT NULL`,
      )
      .run(ISO_TIMESTAMP_GLOB).changes;
    const datesUnreadable = (
      db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE created_at NOT GLOB ?`).get(ISO_TIMESTAMP_GLOB) as { n: number }
    ).n;
    const indexesCreated = missingOrderIndexes();
    for (const name of indexesCreated) db.exec(ORDER_INDEXES[name]!);
    return { datesRewritten, datesUnreadable, indexesCreated };
  })();
}

/**
 * What `npm run migrate` still has to do on this database, in words. Empty
 * when it is up to date. The server refuses to start while this is not empty.
 *
 * A `created_at` that is not a date at all is not listed: the migration cannot
 * fix it, so it must not keep the server down.
 */
export function pendingMigrations(): string[] {
  const pending: string[] = [];
  if (!hasApiKeyColumn()) pending.push('merchants have no API keys');
  const oldDate = db
    .prepare(`SELECT 1 FROM orders WHERE created_at NOT GLOB ? AND ${TO_ISO_TIMESTAMP} IS NOT NULL LIMIT 1`)
    .get(ISO_TIMESTAMP_GLOB);
  if (oldDate) pending.push('some orders store `created_at` in the old format');
  for (const name of missingOrderIndexes()) pending.push(`index ${name} is missing`);
  return pending;
}
