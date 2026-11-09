# Architecture

Node + TypeScript + Express + SQLite (`better-sqlite3`). One process serves the
API under `/api` and the static dashboard in `public/`.

## Modules

- **`server.ts`** — Express bootstrapper. Wires routers to paths behind
  `authMiddleware` and registers the shared error handler last. Refuses to
  start, naming what is missing, while `pendingMigrations()` reports anything
  (see `npm run migrate`). It does not seed data and it does not migrate.
- **`db.ts`** — SQLite connection + schema init. Also `migrateOrders()` (one
  `created_at` format, the two order-list indexes) and `pendingMigrations()`,
  the check the server runs before it listens.
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
  every one of them takes the merchant id as a filter. Listing and searching
  orders is one query, `buildOrderListQuery` (see [Order search](#order-search)).
  `order-rules.ts` holds the money rules (see [Money rules](#money-rules)).
- **`routes/`** — Express routers, one file per resource. Every handler is
  registered through `validated()` and never sees the request object.
  `metrics.ts` does not use the DAL: it runs its own queries on a second,
  read-only connection. It does take the money rules from `dal/order-rules.ts`.
- **`scripts/seed.ts`** — `npm run seed`. Creates demo data when there are no
  orders, prints the API keys of the merchants it creates, and runs
  `migrateOrders()` so a new database starts without `npm run migrate`.
- **`scripts/migrate.ts`** — `npm run migrate`. Adds `merchants.api_key_hash` to
  an older database, issues a key to every merchant without one, and runs
  `migrateOrders()`. Safe to run again.
- **`public/`** — dashboard: static HTML + `fetch`. The merchant pastes an API
  key, which is kept in `sessionStorage` for that tab. The **Orders** section
  is a filter form over `GET /api/orders`, 25 rows at a time with "Load more".
  Order fields are written with `textContent`, never as HTML.

## Authentication and tenancy

1. The client sends its API key as a Bearer token.
2. `auth.ts` hands it to `api-keys.ts`, which hashes it (SHA-256) and looks
   for that hash in `merchants`.
3. No match: `401`. Match: `req.merchantId` is that merchant's id.
4. `validated()` gives that merchant id to the route handler, which passes it
   to every query. Nothing sent by the client (header, query string or body)
   is used as a merchant id.

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
   which can shift values into the wrong columns.
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
by hand, with no validation library: six fields did not justify a dependency.

Dates are accepted only as `YYYY-MM-DD` on purpose: a filter is a UTC day,
not an instant. `orders.created_at` is stored in one format
(`2026-11-06T02:28:37.000Z`), and a date-only bound compares correctly against
it as text.

Validation covers what enters through the API. The database has no `CHECK`
constraints, so anything that writes to it directly (the seed, a script) is
not covered. For rows stored before validation existed, see
[Rows stored before validation](../README.md#rows-stored-before-validation).

## Data model

Two tables: `merchants`, `orders`. See `db.ts` for the canonical DDL.

`merchants.api_key_hash` is unique and may be null (a merchant without a key
cannot authenticate).

`orders.type` is `'sale'` or `'refund'`; the API accepts nothing else, but the
column itself does not enforce it. A refund row has a positive `total_amount`
and records that money was returned. It has no reference to the sale it
reverses and does not change that row.

`orders.status` is always `'completed'`. The list of statuses is
`ORDER_STATUSES` in `validation.ts`; it has one entry because nothing in the
system changes a status. A new status is added there first.

`orders.created_at` is UTC text in one format, `2026-11-06T02:28:37.000Z`.
Text in that format sorts in time order, which the order list and its cursor
rely on. The DAL writes it explicitly; new databases also have it as the
column default. A database from before the migration keeps the old default
(`2026-11-06 02:28:37`), so a row written there directly, without a date, is
in the old format: the server will ask for `npm run migrate` again.

Indexes on `orders`:

| Index | Columns | Used by | Created by |
|---|---|---|---|
| `idx_orders_merchant_created` | `merchant_id, created_at, id` | The order list without an email filter. | `npm run migrate`, `npm run seed` |
| `idx_orders_merchant_email` | `merchant_id, customer_email` (ignoring case) | The order list with an email filter. | `npm run migrate`, `npm run seed` |
| `idx_orders_merchant` | `merchant_id` | Metrics. | schema init |
| `idx_orders_created` | `created_at` | Nothing today. | schema init |

Schema changes to an existing database happen only in `npm run migrate`, never
when the server starts. The server checks and refuses to start instead, so a
migration is always something a person ran on purpose.

## Order search

`GET /api/orders` is the list and the search: the same endpoint, with optional
filters. There is no second endpoint, so there is one query that lists orders
and it cannot disagree with itself. The contract is in
[`api.md`](./api.md#get-apiorders).

**One query.** `buildOrderListQuery` (in `dal/orders-dal.ts`) starts from
`merchant_id = ?` and adds one fixed piece of SQL per filter present, with the
value bound. No client value is ever part of the SQL text.

**Order and cursor.** `ORDER BY created_at DESC, id DESC`. `id` makes the
order total, so a page boundary can fall between two orders of the same
instant. The cursor is the last row's `(created_at, id)`, base64url-encoded;
the next page is `(created_at, id) < (?, ?)`. This is why page 1,000 costs the
same as page 1, and why `created_at` had to be in one format. The query asks
for one row more than the page: if it comes back there is a next page, with no
`COUNT`.

**Email.** "Starts with", ignoring ASCII case, written as a range
(`customer_email >= 'ana' AND customer_email <= 'ana' + last character`,
both compared ignoring case) so the email index applies. It is not `LIKE`, so
`%` and `_` need no escaping. "Contains" was measured and rejected: no index
helps it, and it reads every order of the merchant exactly when few or none
match (about 180 ms with 200,000 orders, in a separate run of the same data
shape).

**The index is named in the query** (`INDEXED BY`), so the cost does not
depend on what the planner guesses or on `ANALYZE` having been run:

- No email filter: `idx_orders_merchant_created` returns the merchant's rows
  already in order. No sort, and the query stops when the page is full.
- Email filter: `idx_orders_merchant_email` goes straight to the matching
  emails, then sorts only those.

`test/order-search.test.ts` fails if either plan stops using its index or
starts sorting where it should not.

**Measured.** 200,000 orders for one merchant (20,000 customers, two years)
plus 50,000 for another, page of 25, median of 31 runs, on a development
machine:

| Search | Time |
|---|---|
| No filters, first page | 0.04 ms |
| No filters, page 1,000 (cursor 100,000 rows in) | 0.04 ms |
| Date range of 30 days | 0.04 ms |
| `type=refund` (15% of the rows) | 0.07 ms |
| Email prefix with 3 matches, or none | 0.02 ms |
| Email prefix with hundreds of matches | 0.2 ms |
| Email prefix `ana` (8,000 matches) | 4 ms |
| Email prefix `a` (32,000 matches) | 20 ms |
| Email `a` + type + dates + amounts | 21 ms |
| Amount range that 0.1% of the rows match | 24 ms |
| Amount range that nothing matches | 132 ms |

Creating both indexes on those 250,000 rows took about 0.35 s; the check the
server runs at start, about 30 ms.

**The slow case that is left.** Without an email filter the query walks the
merchant's orders from newest to oldest until the page is full. A filter that
few rows match (a narrow amount range, or `type=refund` for a merchant with
almost no refunds) walks far; one that nothing matches walks all of them. A
date range bounds the walk. `better-sqlite3` is synchronous, so the process
answers nothing else meanwhile. See [Known gaps](#known-gaps).

**Dashboard.** The form sends only the fields that are filled. Two
conversions happen there, not in the API: amounts are typed in currency units
and sent in cents, and "To" is the last day included, sent as the next day
because the API's `to` is exclusive. Dates are shown in UTC, the same days the
filter uses. "Load more" repeats the last search that worked, with its cursor.

## Money rules

What a row is worth is decided in one file, `src/dal/order-rules.ts`, as three
SQL fragments:

| Fragment | Meaning |
|---|---|
| `IS_SALE` | `type = 'sale'` with an amount the API would accept (integer, 1 to the maximum). |
| `IS_REFUND` | `type = 'refund'` with an amount the API would accept. |
| `NET_AMOUNT` | `+total_amount` for a sale, `-total_amount` for a refund, `0` for anything else. |

Every query that reports money or counts orders is built from them:
`ordersDal.netRevenueByMerchant` (revenue) and the two queries in
`routes/metrics.ts`. The business rules they implement are listed in
[`api.md`](./api.md#money-rules).

Decisions behind them:

- **One definition, two consumers.** Revenue and metrics take what a row is
  worth from the same fragments, so they cannot disagree. A new query that
  reports money must use the fragments, not `total_amount` directly.
- **A refund counts when it was created.** Without a link to the sale there is
  no other date to use. A period can therefore have negative revenue.
- **Invalid rows are worth nothing.** A row with an unknown `type`, or an
  amount that is negative, decimal or above the maximum, is ignored instead of
  guessed at. Subtracting a refund stored as `-500` would add 500. The amount
  limit comes from `MAX_TOTAL_AMOUNT` in `validation.ts`, so the rule for
  counting a row and the rule for accepting it cannot drift apart.
- **Rules are applied when reading.** Nothing stored is changed or deleted, so
  the rules can be revised without a data migration.
- **The summary is one query.** Its three figures come from a single pass over
  the merchant's rows, so they are always consistent with each other.

Cost: each of these queries reads every order of the merchant (found through
`idx_orders_merchant`). Measured on a development machine with 200,000 orders
for one merchant: summary about 50 ms, revenue over a year about 20 ms,
top-customers about 50 ms. `better-sqlite3` is synchronous, so the process
answers nothing else while one of these runs.

## Configuration

| Variable | Default | |
|---|---|---|
| `DB_PATH` | `data/dashboard.db` | SQLite file, relative to the working directory |
| `PORT` | `3000` | |

## Tests

`npm test` runs every `*.test.ts` under `test/`, each file in its own process.
The tests use an in-memory database, except the two that load
`routes/metrics.ts`, which use a file in a temp folder (see the table).

| File | Covers |
|---|---|
| `auth.test.ts`, `migrate.test.ts`, `seed.test.ts`, `orders.test.ts` | Auth, migration, seed and the orders DAL. |
| `validation.test.ts` | Every input rule, including the order filters and the cursor, with no database and no HTTP. |
| `routes.test.ts` | Orders and revenue over real HTTP: valid requests, each invalid one answering 400 and storing nothing, 413 / 415, and that a server failure is still a 500. |
| `money-rules.test.ts` | The money rules over HTTP, on revenue and both metrics endpoints: refunds subtract, a period can be negative, invalid stored rows are ignored, merchants with no sales get zeros, and revenue agrees with top-customers. Temp database file, as below. |
| `metrics-limit.test.ts` | `limit` in top-customers over HTTP. Uses a database file in a temp folder, because `routes/metrics.ts` cannot open an in-memory database. |
| `route-guard.test.ts` | The gate described in Input validation. |
| `order-search.test.ts` | Order search over HTTP: each filter, their combination, email prefix and case, `%` / `_` as plain text, the cursor (every order once, in order, across a tie and while orders are created), other merchants never reached, each invalid value answering 400. Also the query plan of both indexes. |
| `migrate-orders.test.ts` | `created_at` rewritten to one format without moving the instant, the indexes, running twice, a value that is not a date, and what `pendingMigrations()` reports before and after. |

The HTTP tests build their own Express app in `test/helpers/app.ts`, wired
like `server.ts`, because `server.ts` starts listening when imported. The
dashboard (`public/`) has no automated test.

## Known gaps

- No HTTPS, rate limiting or request log in this process.
- The dashboard's "Revenue (last 30 days)" asks for a range that ends today
  (exclusive, UTC), so it leaves out today's orders. The API figure is right
  for the range it is given.
- Order search, see [Order search](#order-search):
  - A filter that few or no orders match, without an email or a date range,
    reads all the merchant's orders (132 ms measured with 200,000). An index
    per filter was not added: each one costs on every insert.
  - Email search is by prefix only (`@gmail.com` finds nothing), and ignores
    case for A to Z only.
  - No total count and no choice of sort order.
  - A `created_at` that is not a date at all (only possible by writing to the
    database directly) is left as it is by the migration and sorts out of
    place.
  - `idx_orders_merchant_created` makes `idx_orders_merchant` redundant, and
    `idx_orders_created` is used by nothing. Neither was dropped.
- The dashboard shows order dates in UTC, not in the merchant's time zone.
- A refund is not linked to a sale: nothing stops refunding more than was
  sold, and a refund cannot be attributed to the sale's period.
- Revenue and metrics read every order of the merchant on each request, with
  no pre-computed totals. Fine at the measured size; it grows linearly with
  the merchant's orders. They were not measured again after
  `idx_orders_merchant_created` was added for order search.
- The summary and top-customers are all-time; they take no date range.
- The database does not enforce the input rules (no `CHECK` constraints).
- `customer_email` rejects `<` and `>` but is otherwise free text shaped like
  an email. The dashboard shows it as text; any other consumer of the API has
  to treat it as text too.
- A path under `/api` that matches no route answers with Express's HTML 404.
