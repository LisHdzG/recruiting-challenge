# Architecture

Node + TypeScript + Express + SQLite (`better-sqlite3`). One process serves the
API under `/api` and the static dashboard in `public/`.

## Modules

- **`server.ts`** — Express bootstrapper. Wires routers to paths behind
  `authMiddleware` and registers the shared error handler last. Refuses to start if the database predates API keys (see
  `npm run migrate`). It does not seed data.
- **`db.ts`** — SQLite connection + schema init.
- **`auth.ts`** — request authentication. Reads `Authorization: Bearer <key>`,
  resolves the merchant from the key and sets `req.merchantId`. This is the
  only place a request gets a merchant identity.
- **`api-keys.ts`** — generates, hashes, issues and looks up merchant API keys.
- **`validation.ts`** — the input rules. Pure functions (no Express, no
  database) that turn raw query strings and bodies into typed values or throw
  a `ValidationError` listing every field that failed. One `parse*` function
  per endpoint input, built from shared rules (`parseDateRange`, `parseLimit`).
- **`validate-request.ts`** — the Express side of validation: the
  `validated()` wrapper every route uses, which also rejects arrays and
  objects in any field.
- **`errors.ts`** — the one error handler. Client errors become 4xx in a single
  shape; anything else is `500 internal_error` with the detail in the log.
- **`dal/`** — data-access layer. Order queries go through `ordersDal`, and
  every one of them takes the merchant id as a filter.
- **`routes/`** — Express routers, one file per resource. Every handler is
  registered through `validated()` and never sees the request object.
  `metrics.ts` does not use the DAL: it runs its own queries on a second,
  read-only connection.
- **`scripts/seed.ts`** — `npm run seed`. Creates demo data when there are no
  orders and prints the API keys of the merchants it creates.
- **`scripts/migrate.ts`** — `npm run migrate`. Adds `merchants.api_key_hash` to
  an older database and issues a key to every merchant without one. Safe to
  run again.
- **`public/`** — dashboard: static HTML + `fetch`. The merchant pastes an API
  key, which is kept in `sessionStorage` for that tab. Order fields are written
  with `textContent`, never as HTML.

## Authentication and tenancy

1. The client sends its API key as a Bearer token.
2. `auth.ts` hashes it (SHA-256) and looks for that hash in `merchants`.
3. No match: `401`. Match: `req.merchantId` is that merchant's id.
4. Routes pass `req.merchantId` to every query. Nothing sent by the client
   (header, query string or body) is used as a merchant id.

Keys are random (24 bytes), shown once when issued and stored only as a hash.
There is no key rotation yet.

## Input validation

What a client sends is untrusted until it has been validated, and what was
stored is untrusted when it is shown. A request goes through these steps, in
this order:

1. `express.json()` reads the body (100 KB limit).
2. `authMiddleware` resolves the merchant, or answers `401`. Nothing below
   runs for a request without a valid key.
3. `validated({ query, body }, handler)` wraps every route handler. It first
   rejects any query parameter or body field that is an array or an object,
   whether the route uses it or not. Express turns `?limit=1&limit=2` into an
   array, and the SQLite driver spreads an array over several bind parameters,
   which used to shift values into the wrong columns.
4. `validated()` then runs the route's parsers from `validation.ts`. If any
   field fails, it throws one `ValidationError` with all the failures and the
   handler does not run.
5. The handler receives `{ query, body, merchantId, params }` — parsed values
   only — and the response. It has no access to `req`.
6. `errorHandler` turns a `ValidationError` into `400 invalid_request`.

Three things keep a new route from skipping this:

- The array/object check is part of `validated()`: a route inherits it, and
  `validated()` refuses to run a handler that has no authenticated merchant.
- Handlers written with `validated()` cannot read raw input, because they are
  never given the request.
- `test/route-guard.test.ts` fails if a file in `src/routes/` registers a
  route without `validated()` or mentions `req`, `.query` or `.body`, if
  `server.ts` mounts a router without `authMiddleware` first, or if a route
  other than `/api/health` is written directly in `server.ts`. It is a text check: it stops an oversight, not someone
  working around it on purpose.

**Adding a route:** write (or reuse) a `parse*` function in `validation.ts`,
register the handler with `validated({ query: parseX }, ...)`, and mount the
router in `server.ts` behind `authMiddleware`. **Adding a field:** add its rule
to the parser, a case to `test/validation.test.ts` and a row to the table in
`docs/api.md`.

The rules themselves are in [`api.md`](./api.md#input-rules). They are written
by hand, with no validation library: five fields did not justify a dependency.

Dates are accepted only as `YYYY-MM-DD` on purpose. `orders.created_at` holds
two formats (`2026-11-06T00:00:01.000Z` from the seed, `2026-11-06 02:28:37`
from the API). A date-only bound compares correctly against both; a bound with
a time does not.

Validation covers what enters through the API. The database has no `CHECK`
constraints, so anything that writes to it directly (the seed, a script) is
not covered, and rows stored before validation existed stay as they are until
someone decides what to do with them (the README has a query to list them).

## Data model

Two tables: `merchants`, `orders`. See `db.ts` for the canonical DDL.

`merchants.api_key_hash` is unique and may be null (a merchant without a key
cannot authenticate).

`orders.type` is `'sale'` or `'refund'`; the API accepts nothing else, but the
column itself does not enforce it. A refund row has a positive `total_amount`
and records that a sale was reversed; it does not by itself reverse the sale
row.

## Configuration

| Variable | Default | |
|---|---|---|
| `DB_PATH` | `data/dashboard.db` | SQLite file, relative to the working directory |
| `PORT` | `3000` | |

## Tests

`npm test` runs `test/*.test.ts`, each file in its own process, on an
in-memory database.

| File | Covers |
|---|---|
| `auth.test.ts`, `migrate.test.ts`, `seed.test.ts`, `orders.test.ts` | Auth, migration, seed and the orders DAL. |
| `validation.test.ts` | Every input rule, with no database and no HTTP. |
| `routes.test.ts` | Orders and revenue over real HTTP: valid requests, each invalid one answering 400 and storing nothing, 413 / 415, and that a server failure is still a 500. |
| `metrics-limit.test.ts` | `limit` in top-customers over HTTP. Uses a database file in a temp folder, because `routes/metrics.ts` cannot open an in-memory database. |
| `route-guard.test.ts` | The gate described in Input validation. |

The HTTP tests build their own Express app in `test/helpers/app.ts`, wired
like `server.ts`, because `server.ts` starts listening when imported. The
dashboard (`public/`) has no automated test.

## Known gaps

- No HTTPS, rate limiting or request log in this process.
- The database does not enforce the input rules (no `CHECK` constraints).
- `customer_email` rejects `<` and `>` but is otherwise free text shaped like
  an email. The dashboard shows it as text; any other consumer of the API has
  to treat it as text too.
- A path under `/api` that matches no route answers with Express's HTML 404.
