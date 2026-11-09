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

`created_at` is UTC.

## Endpoints

### `GET /api/health`
No auth. Returns `{ "ok": true }`.

### `GET /api/orders`
Orders of the merchant, newest first. Returns `{ "orders": [Order] }`.

| Query | Default | Notes |
|---|---|---|
| `from`, `to` | none | Applied only when both are sent. `from` is inclusive, `to` is exclusive. |
| `limit` | 100 | |

### `GET /api/orders/:id`
Returns `{ "order": Order }`.
`404 { "error": "not_found" }` if the ID does not exist or belongs to another merchant.

### `POST /api/orders`
Body: `{ "customer_email": string, "total_amount": number, "type"?: "sale" | "refund" }`.
`type` defaults to `"sale"`. The order is created for the merchant of the key.

Returns `201 { "order": Order }`.
`400 { "error": "invalid_body" }` if `customer_email` is missing or `total_amount` is not a number.

### `GET /api/revenue?from=...&to=...`
Sum of `total_amount` in the range (`from` inclusive, `to` exclusive). Both are required.

```json
{ "merchant_id": "m_acme", "from": "2026-10-01", "to": "2026-11-01", "revenue_cents": 412118, "revenue": 4121.18 }
```

`400 { "error": "missing_date_range" }` if either date is missing.

### `GET /api/metrics/summary`
```json
{ "merchant_id": "m_acme", "total_orders": 40, "unique_customers": 6, "avg_order_value_cents": 10303 }
```

### `GET /api/metrics/top-customers`
Customers by total spent, highest first. Query: `limit` (default 5).

```json
{ "customers": [{ "customer_email": "carla@example.com", "order_count": 9, "total_spent": 138049 }] }
```

## Errors

| Status | Body |
|---|---|
| 400 | `{ "error": "invalid_body" }` or `{ "error": "missing_date_range", "detail": "..." }` |
| 401 | `{ "error": "unauthorized" }` |
| 404 | `{ "error": "not_found" }` |
| 500 | `{ "error": "internal_error" }` (details go to the server log only) |
