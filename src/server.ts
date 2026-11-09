import express from 'express';
import { db, initSchema, pendingMigrations } from './db.js';
import { authMiddleware } from './auth.js';
import { errorHandler } from './errors.js';
import { ordersRouter } from './routes/orders.js';
import { revenueRouter } from './routes/revenue.js';
import { metricsRouter } from './routes/metrics.js';

initSchema();
const pending = pendingMigrations();
if (pending.length > 0) {
  console.error(`This database needs a migration: ${pending.join('; ')}.`);
  console.error('Run `npm run migrate` (or `npm run seed` if this is a new, empty database), then start again.');
  process.exit(1);
}
if ((db.prepare(`SELECT COUNT(*) AS n FROM merchants`).get() as { n: number }).n === 0) {
  console.log('No merchants yet. Run `npm run seed` to create demo data and API keys.');
}

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use(express.static('public'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/orders', authMiddleware, ordersRouter);
app.use('/api/revenue', authMiddleware, revenueRouter);
app.use('/api/metrics', authMiddleware, metricsRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`dashboard server listening on http://localhost:${PORT}`);
});
