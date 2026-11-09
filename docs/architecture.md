# Architecture

Node + TypeScript + Express + SQLite (`better-sqlite3`). One process serves the
API under `/api` and the static dashboard in `public/`.

## Modules

- **`server.ts`** — Express bootstrapper. Wires routers to paths. Refuses to
  start if the database predates API keys (see `npm run migrate`). It does not
  seed data.
- **`db.ts`** — SQLite connection + schema init.
- **`auth.ts`** — request authentication. Reads `Authorization: Bearer <key>`,
  resolves the merchant from the key and sets `req.merchantId`. This is the
  only place a request gets a merchant identity.
- **`api-keys.ts`** — generates, hashes, issues and looks up merchant API keys.
- **`dal/`** — data-access layer. Order queries go through `ordersDal`, and
  every one of them takes the merchant id as a filter.
- **`routes/`** — Express routers, one file per resource. `metrics.ts` does not
  use the DAL: it runs its own queries on a second, read-only connection.
- **`scripts/seed.ts`** — `npm run seed`. Creates demo data when there are no
  orders and prints the API keys of the merchants it creates.
- **`scripts/migrate.ts`** — `npm run migrate`. Adds `merchants.api_key_hash` to
  an older database and issues a key to every merchant without one. Safe to
  run again.
- **`public/`** — dashboard: static HTML + `fetch`. The merchant pastes an API
  key, which is kept in `sessionStorage` for that tab.

## Authentication and tenancy

1. The client sends its API key as a Bearer token.
2. `auth.ts` hashes it (SHA-256) and looks for that hash in `merchants`.
3. No match: `401`. Match: `req.merchantId` is that merchant's id.
4. Routes pass `req.merchantId` to every query. Nothing sent by the client
   (header, query string or body) is used as a merchant id.

Keys are random (24 bytes), shown once when issued and stored only as a hash.
There is no key rotation yet.

## Data model

Two tables: `merchants`, `orders`. See `db.ts` for the canonical DDL.

`merchants.api_key_hash` is unique and may be null (a merchant without a key
cannot authenticate).

`orders.type` is expected to be `'sale'` or `'refund'`. A refund row records
that a sale was reversed; it does not by itself reverse the sale row.

## Configuration

| Variable | Default | |
|---|---|---|
| `DB_PATH` | `data/dashboard.db` | SQLite file, relative to the working directory |
| `PORT` | `3000` | |

## Tests

`npm test` runs `test/*.test.ts` on an in-memory database. They cover auth,
the orders DAL, the seed and the migration. Routes are not covered: importing
`routes/metrics.ts` fails with an in-memory database.

## Known gaps

- The dashboard renders `customer_email` as HTML (XSS). A script injected that
  way can read the API key in `sessionStorage`.
- No HTTPS, rate limiting or request log in this process.
