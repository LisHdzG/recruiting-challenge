# T1 Engineering Recruiting Challenge

Welcome. This is a small merchant-dashboard application with some problems. Your job is to find what's wrong, fix it, and add one feature — then tell us how you thought about it.

We care less about *whether* you finish than *how* you decide what to do. Read [`EVALUATION.md`](./EVALUATION.md) before you start.

---

## What you'll do

1. **Fork** this repo to your own GitHub account. Make your fork public.
2. **Set up the app locally** (instructions below). Run it. Click around the dashboard.
3. **Identify and address at least 3 quality issues.** Treat this codebase the way you'd treat a real production system that just landed on your desk: things that work but shouldn't, things that are missing, things whose shape could be better, things that won't scale, things that aren't safe. Some are easy to spot, some take more reading. We don't tell you in advance which ones — surfacing them is part of the exercise. **The entire codebase, docs, and API surface are fair game.** You decide what's worth improving and why.
4. **Pick one feature from the menu below and add it.** You choose. Tell us why you chose it.
5. **Improve the documentation** as you go. The `docs/` directory is out of date and incomplete; treat it as part of the codebase.
6. **Submit** the six artifacts described in [`SUBMISSION.md`](./SUBMISSION.md). Some of them must be written by you, without AI — read [`SUBMISSION.md`](./SUBMISSION.md) before you start.

**Expected time: ~6 hours.** If you spend a lot more or a lot less, write down why in your decision log — we'll read it.

---

## Setup

Step-by-step guide (fresh clone, updating an existing copy, common problems): [`docs/setup.md`](./docs/setup.md).

Requirements: **Node 20+**.

```sh
npm install
npm run seed   # demo data + one API key per merchant, shown only once
npm run dev
```

The app starts at <http://localhost:3000>. The dashboard is at `/`, the API at `/api/*`.

If port 3000 is taken: `PORT=3055 npm run dev`.

**Windows note.** `better-sqlite3` builds a native module on install; if it fails, you'll need Visual Studio build tools or `windows-build-tools`. Modern Node distributions usually ship with what you need. macOS and Linux: no extra setup.

The database is SQLite, kept in `data/dashboard.db`. `npm run seed` creates two merchants (`m_acme`, `m_bistro`) and ~80 orders, and prints an API key for each merchant. Copy the keys: only their hash is stored, so they cannot be shown again. To start over, delete the file and run `npm run seed`. The server never seeds on its own.

**If you already have a `data/dashboard.db` from an earlier version:**

- From before API keys existed: run `npm run migrate` once. It adds the key column and prints a key for each existing merchant; the server will not start until you do.
- From before order search existed: run `npm run migrate` once. It rewrites every order's `created_at` to one format (`2026-11-06T02:28:37.000Z`, the same instant) and creates the two indexes the order list uses; the server will not start until you do. A database created by `npm run seed` is already up to date.
- From before input validation existed: no migration is needed for that. See [Rows stored before validation](#rows-stored-before-validation).

### Rows stored before validation

A database from before input validation may hold orders the API would reject today (negative or decimal amounts, a `type` other than `sale` / `refund`, text that is not an email). Validation stops new ones; it does not fix or delete what is already stored. Rows with an invalid amount or `type` are still listed by `GET /api/orders`, but they do not count in revenue or metrics (a row with only an invalid email still counts). To list them, run this read-only query (`sqlite3 data/dashboard.db`). It follows the API rules closely, not exactly: the email check is an approximation.

```sql
SELECT id, merchant_id, customer_email, total_amount, type
FROM orders
WHERE typeof(total_amount) <> 'integer' OR total_amount < 1 OR total_amount > 100000000
   OR type NOT IN ('sale', 'refund')
   OR typeof(customer_email) <> 'text' OR length(customer_email) > 254
   OR customer_email NOT LIKE '%_@_%._%' OR customer_email LIKE '%@%@%'
   OR customer_email GLOB '*[ <>]*';
```

**How money is counted.** Revenue is sales minus refunds. The number of orders, the number of customers and the average order value count sales only. Top customers are ranked by what they spent net of their refunds. The rules are defined once, in `src/dal/order-rules.ts`, and listed in [`docs/api.md`](./docs/api.md#money-rules). A refund subtracts on the date the refund was created.

The API validates everything a client sends before it reaches a query and answers `400` with the fields that failed; see [`docs/api.md`](./docs/api.md#input-rules). Clients written against the first version should read [Breaking changes](./docs/api.md#breaking-changes).

```sh
npm test     # run the (intentionally thin) test suite
```

**Order search (Feature C).** `GET /api/orders` takes filters (start of the customer email, type, status, date range, amount range) and pages with a cursor; the dashboard's **Orders** section is a form over it. The contract is in [`docs/api.md`](./docs/api.md#get-apiorders), the design and the measurements with 200,000 orders in [`docs/architecture.md`](./docs/architecture.md#order-search).

To use the dashboard, paste a merchant's API key at the top of the page. The client sends it as `Authorization: Bearer <key>` on every API request, and the server resolves the merchant from the key — see `src/auth.ts` and [`docs/api.md`](./docs/api.md).

The dashboard shows order fields (customer email, type) as plain text. Text stored in an order is never interpreted as HTML, including orders stored before validation existed.

---

## Feature menu — pick one

Pick exactly one. Implement it, integrate it into the dashboard if it has a UI surface, and explain your choice in your decision log.

### Feature A — CSV export of orders

Add an endpoint and a "Download CSV" button that exports the merchant's orders for a given date range as CSV. The candidate decides the column shape, the auth model, the format conventions (dates, currency, escaping), and how to handle large result sets.

### Feature B — Order-event webhooks

Add a way for merchants to register an HTTPS URL and receive a POST notification when an order is created, refunded, or its status changes. The candidate decides the event payload, the delivery guarantees, the retry policy, the auth between us and the merchant, and how a merchant manages their subscriptions.

### Feature C — Order search with filters

Add a search endpoint (and dashboard UI) that lets the merchant find orders by customer email, status, type (sale / refund), date range, and amount range. The candidate decides pagination, sort order, performance under larger datasets, and how the query shape is exposed in the API.

You can sketch a fourth option if none of these fit your strengths — just be very explicit in the decision log about what you built and why.

---

## What you submit

See [`SUBMISSION.md`](./SUBMISSION.md). In short, **six artifacts**:

1. **A link to your fork** with your work merged or in a clearly named branch — with multiple commits, **human-written commit messages**, not one giant squash.
2. **`decision_log.md`** — **human-written.** Two pages on what you chose to do, your confidence per fix, where you disagreed with the AI, and where you felt uncertain.
3. **`validation_design.md`** — **human-written.** ~300 words on the gates you built (or would build) to catch the *class* of bug, not just the instance.
4. **`signoff.md`** — **human-written.** One line per meaningful commit: what you read, what you trusted, what you took on faith.
5. **`prompt_history.md`** — raw AI conversation transcript. No curation. Includes a mandatory "what Claude got wrong" section.
6. **`written_answers.md`** — **human-written.** Three past-tense behavioral questions.

Templates for each are in the repo root (`*.template.md`). Each human-written artifact opens with a one-line authorship declaration. **Mislabeling — claiming "no AI" on a doc that's clearly AI-generated — is treated as evidence of dishonesty.**

Email your submission to the recruiter you've been talking to. They'll get back to you within a week.

---

## A note on AI

You should use AI on the code. Claude Code, Cursor, Copilot, Aider, ChatGPT — whatever you actually work with. We are not testing whether you can write code without help. We are testing how you direct, review, and decide. The prompt history is where that signal lives.

**But the written deliverables are different.** `decision_log.md`, `validation_design.md`, `signoff.md`, `written_answers.md`, and your commit messages must be **written by you, without AI**. Spell-check is fine. AI-laundered written deliverables are an automatic decline — see [`SUBMISSION.md`](./SUBMISSION.md) for the full table and why we draw the line there.

You do not need to "perform AI use" on the code side — if you only used it for one thing, write that one thing. If you used it for everything, write what you accepted, what you rejected, and what you had to re-prompt to fix. The mandatory "what Claude got wrong" section in `prompt_history.md` is where you show critical review.

---

## Questions?

Don't ask us. Make a decision, document it, and move on. We'd rather see you call your shot in writing than see you blocked on clarification. If your call turns out to be wrong, your decision log is where you tell us what you'd do differently.

---

## Found this repo without a recruiter contact?

If you reached this repo organically and want to use it as an entry point into T1 engineering, send your submission and a short note about how you found us to **<recruiting@t1.com>** (or the address listed on the T1 careers page). We do hire from cold submissions.

