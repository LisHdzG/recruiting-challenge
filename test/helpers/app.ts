import express, { type Express } from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { errorHandler } from '../../src/errors.js';

/**
 * Starts an Express app wired like `src/server.ts` (JSON body, routers, shared
 * error handler) on a free port. `server.ts` itself cannot be
 * imported in a test: it starts listening and may exit the process.
 */
export async function startApp(mount: (app: Express) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export interface Reply {
  status: number;
  body: any;
}

/** Fields named in a 4xx reply, in order. */
export function fields(reply: Reply): string[] {
  return (reply.body?.details ?? []).map((d: { field: string }) => d.field);
}
