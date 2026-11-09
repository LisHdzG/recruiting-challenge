# API reference

Base path: `/api`. Requests and responses are JSON. Amounts are in cents.

## Authentication

Every endpoint except `/api/health` requires the merchant's API key:

```
Authorization: Bearer <api key>
```

The server looks the key up in the database and works on that merchant's data
only. There is no way to name a merchant in a header, query string or body.

A missing, malformed or unknown key returns `401 { "error": "unauthorized" }`.

Keys are printed once by `npm run seed` (new database) or `npm run migrate`
(database created before API keys). Only their SHA-256 hash is stored, so a
lost key cannot be recovered.

## Input rules

Nothing a client sends is trusted. After the API key is verified, every query
parameter and body field is checked before any query on orders runs; a request
that breaks a rule is rejected with `400` (see [Errors](#errors)) and nothing
is stored.

**Everywhere, on every authenticated route:** no query parameter and no body field may
be an array or an object. That includes a repeated parameter
(`?limit=1&limit=2`), `?limit[]=1` and `?limit[a]=1`. Unknown parameters and
fields with a single value are ignored.

| Field | Where | Rule |
|---|---|---|
| body | `POST /api/orders` | A JSON object, at most 100 KB. |
| `customer_email` | body | Required. Text shaped like `name@example.com`, with no spaces and no `<` or `>`, at most 254 characters. Stored as sent (no trimming, no lower-casing). |
| `total_amount` | body | Required. A JSON number whose value is an integer between `1` and `100000000` (cents). `12.5` and `"5000"` are rejected. `5000.0` is accepted: in JSON it is the integer 5000. |
| `type` | body | Optional. `"sale"` or `"refund"`. Leaving it out means `"sale"`; `null` or any other value is rejected. |
| `from`, `to` | query of `/api/orders` and `/api/revenue` | `YYYY-MM-DD`, a date that exists, with `from` earlier than `to`. Days are UTC; `from` is inclusive, `to` is exclusive. Required in `/api/revenue`. Optional in `/api/orders`, but both or neither. A time (`2026-11-06T00:00:00Z`) is rejected. |
| `limit` | query of `/api/orders` and `/api/metrics/top-customers` | Optional. Digits only, between `1` and `100`. |

A refund is an order with a positive `total_amount` and `"type": "refund"`.
How it counts is in [Money rules](#money-rules).

## Money rules

Revenue and metrics follow the same rules, defined once in
`src/dal/order-rules.ts`:

| Figure | Rule |
|---|---|
| Revenue | Sales minus refunds. |
| Number of orders | Sales only. A refund is not an order. |
| Number of customers | Customers with at least one sale. |
| Average order value | Sum of sales divided by number of sales. Refunds do not lower it, so average × orders is not the revenue. |
| Customer's total spent | That customer's sales minus their refunds. |

- A refund subtracts in the period **the refund was created**, not the period
  of the sale: a refund is not linked to a sale. Revenue for a period can be
  negative.
- A stored row the API would reject today on `type` or `total_amount` is not
  counted anywhere. See
  [Rows stored before validation](../README.md#rows-stored-before-validation).
- `GET /api/orders` is not affected: it lists every stored row, refunds
  included.

## Order object

```json
{
  "id": "uuid",
  "merchant_id": "m_acme",
  "customer_email": "ana@example.com",
  "total_amount": 5000,
  "type": "sale",
  "status": "completed",
  "created_at": "2026-11-06 02:28:37"
}
```

`created_at` is UTC. `id`, `merchant_id`, `status` and `created_at` are set by
the server; sending them in a body has no effect.

## Endpoints

### `GET /api/health`
No auth. Returns `{ "ok": true }`.

### `GET /api/orders`
Orders of the merchant, newest first. Returns `{ "orders": [Order] }`.

| Query | Default | Notes |
|---|---|---|
| `from`, `to` | none | Both or neither. See [Input rules](#input-rules). |
| `limit` | 100 | 1 to 100. |

### `GET /api/orders/:id`
Returns `{ "order": Order }`.
`404 { "error": "not_found" }` if the ID does not exist or belongs to another merchant.

### `POST /api/orders`
Body: `{ "customer_email": string, "total_amount": integer, "type"?: "sale" | "refund" }`.
The order is created for the merchant of the key.

Returns `201 { "order": Order }`.

```sh
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"customer_email":"ana@example.com","total_amount":5000}'
```

### `GET /api/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD`
Net revenue in the range: sales minus refunds (see [Money rules](#money-rules)).
Both dates are required. `revenue_cents` is an integer and can be negative;
`revenue` is the same amount in currency units.

```json
{ "merchant_id": "m_acme", "from": "2026-10-01", "to": "2026-11-01", "revenue_cents": 290698, "revenue": 2906.98 }
```

To include today, send tomorrow's date as `to`.

### `GET /api/metrics/summary`
All-time figures for the merchant, counting sales only (see
[Money rules](#money-rules)). A merchant with no sales gets zeros.

| Field | Meaning |
|---|---|
| `total_orders` | Number of sales. |
| `unique_customers` | Customers with at least one sale. |
| `avg_order_value_cents` | Sum of sales / number of sales, rounded to a whole cent. |

```json
{ "merchant_id": "m_acme", "total_orders": 34, "unique_customers": 6, "avg_order_value_cents": 10336 }
```

### `GET /api/metrics/top-customers`
Customers by net spent (their sales minus their refunds), highest first; ties
in alphabetical order. `order_count` is the customer's number of sales. A
customer with no sale, or with a net of zero or less, is not listed. Query:
`limit` (default 5, 1 to 100).

```json
{ "customers": [{ "customer_email": "carla@example.com", "order_count": 7, "total_spent": 84713 }] }
```

## Errors

Every error caused by the request has the same shape and names each field that
failed, all of them at once:

```json
{
  "error": "invalid_request",
  "details": [
    { "field": "total_amount", "issue": "must be an integer number of cents between 1 and 100000000" },
    { "field": "type", "issue": "must be \"sale\" or \"refund\" (or left out, which means \"sale\")" }
  ]
}
```

`field` is the parameter or body field; `body` means the body as a whole,
`path` the URL path and `Content-Type` the header. The `issue` text is meant
for people and may be reworded; match on `error` and `field`.

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | A rule in [Input rules](#input-rules) is broken, the body is not valid JSON, or the path is not valid URL encoding. |
| 401 | `unauthorized` | Missing, malformed or unknown API key. No `details`. |
| 404 | `not_found` | Order not found for this merchant. No `details`. |
| 413 | `payload_too_large` | Body over 100 KB. |
| 415 | `unsupported_media_type` | Body sent in a charset or encoding the server does not read. |
| 500 | `internal_error` | A failure on the server. No `details`; they go to the server log only. |

Authentication comes first: a request without a valid key gets `401` whatever
else is wrong with its parameters or fields. The one exception is the body
itself, which is read before authentication, so a body that is not valid JSON,
is too large or has an unsupported charset gets `400` / `413` / `415` even
without a key.

A path under `/api` that matches no route still answers with Express's default
HTML `404` page.

## Breaking changes

For a client written against the first version of this API:

- **Authentication.** `X-Merchant-Id` is not accepted. Send the merchant's API
  key as `Authorization: Bearer <api key>`. The `401` error code is
  `unauthorized`, not `missing_merchant_id`.
- **Orders of another merchant.** `GET /api/orders/:id` answers `404` for an
  order that belongs to another merchant.
- **Error codes.** `invalid_body` and `missing_date_range` do not exist. Both
  are `invalid_request` with `details` (see [Errors](#errors)).
- **Requests that are now `400`.** `limit` of `0`, negative, above 100 or not
  digits; `from` without `to` (or the reverse) in `/api/orders`; dates with a
  time or that are not real dates; decimal or non-positive amounts; `type`
  other than `sale` / `refund`; a `customer_email` not shaped like an email;
  any parameter or field that is an array or an object.
- **Figures.** Refunds are not added as sales. `revenue_cents` subtracts them,
  `total_orders`, `unique_customers` and `avg_order_value_cents` count sales
  only, and top-customers ranks by net spent. The response shapes are the
  same; the numbers are lower for any merchant with refunds.
