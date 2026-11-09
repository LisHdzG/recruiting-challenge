import { db, initSchema, hasApiKeyColumn } from '../db.js';
import { issueApiKey } from '../api-keys.js';
import { randomUUID } from 'node:crypto';

const MERCHANTS = [
  { id: 'm_acme', name: 'Acme Supplies' },
  { id: 'm_bistro', name: 'Bistro Verde' },
];

const CUSTOMERS = [
  'ana@example.com',
  'bruno@example.com',
  'carla@example.com',
  'diego@example.com',
  'elena@example.com',
  'felipe@example.com',
];

function randomDateInLast90Days(): string {
  const now = Date.now();
  const offsetMs = Math.floor(Math.random() * 90 * 24 * 60 * 60 * 1000);
  return new Date(now - offsetMs).toISOString();
}

/**
 * Seeds demo data when there are no orders. Returns the API keys issued to
 * merchants created by this run; they cannot be read back later.
 */
export function seedIfEmpty(): Array<{ merchantId: string; apiKey: string }> {
  initSchema();
  if (!hasApiKeyColumn()) {
    throw new Error('This database was created before API keys. Run `npm run migrate` first.');
  }
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as { n: number };
  if (existing.n > 0) return [];

  const insertMerchant = db.prepare(
    `INSERT OR IGNORE INTO merchants (id, name) VALUES (?, ?)`,
  );
  const issued: Array<{ merchantId: string; apiKey: string }> = [];
  for (const m of MERCHANTS) {
    if (insertMerchant.run(m.id, m.name).changes === 1) {
      issued.push({ merchantId: m.id, apiKey: issueApiKey(m.id) });
    }
  }

  const insertOrder = db.prepare(
    `INSERT INTO orders (id, merchant_id, customer_email, total_amount, type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction(() => {
    for (let i = 0; i < 80; i++) {
      const merchant = MERCHANTS[i % MERCHANTS.length]!;
      const customer = CUSTOMERS[i % CUSTOMERS.length]!;
      const amount = Math.floor(2000 + Math.random() * 18000);
      const type: 'sale' | 'refund' = Math.random() < 0.15 ? 'refund' : 'sale';
      insertOrder.run(
        randomUUID(),
        merchant.id,
        customer,
        amount,
        type,
        'completed',
        randomDateInLast90Days(),
      );
    }
  });
  insertMany();
  console.log(`[seed] inserted ${issued.length} merchants and 80 orders`);
  return issued;
}

const isMain = import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? '');
if (isMain) {
  const issued = seedIfEmpty();
  for (const { merchantId, apiKey } of issued) {
    console.log(`[seed] API key for ${merchantId}: ${apiKey}`);
  }
  console.log(
    issued.length > 0
      ? '[seed] Keys are shown only once. Copy them now.'
      : '[seed] no new merchants, so no API keys were issued',
  );
}
