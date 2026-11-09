import { pathToFileURL } from 'node:url';
import { db, initSchema, hasApiKeyColumn } from '../db.js';
import { issueApiKey } from '../api-keys.js';

/**
 * Brings a database created before API keys up to date: adds the
 * `api_key_hash` column and issues a key to every merchant that has none.
 * Safe to run more than once; merchants that already have a key keep it.
 */
export function migrate(): Array<{ merchantId: string; apiKey: string }> {
  initSchema();
  return db.transaction(() => {
    if (!hasApiKeyColumn()) {
      db.exec(`ALTER TABLE merchants ADD COLUMN api_key_hash TEXT`);
      db.exec(`CREATE UNIQUE INDEX idx_merchants_api_key_hash ON merchants(api_key_hash)`);
    }
    const pending = db
      .prepare(`SELECT id FROM merchants WHERE api_key_hash IS NULL ORDER BY id`)
      .all() as Array<{ id: string }>;
    return pending.map(({ id }) => ({ merchantId: id, apiKey: issueApiKey(id) }));
  })();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const issued = migrate();
  for (const { merchantId, apiKey } of issued) {
    console.log(`[migrate] API key for ${merchantId}: ${apiKey}`);
  }
  console.log(
    issued.length > 0
      ? '[migrate] Keys are shown only once. Copy them now.'
      : '[migrate] nothing to do: every merchant already has a key',
  );
}
