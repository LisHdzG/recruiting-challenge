# Decision Log — Hernández Guzmán Marian Lisette

> **Write this yourself, without AI assistance.** Spell-check is fine. AI-drafted, AI-rewritten, or AI-polished decision logs are an automatic decline — see `SUBMISSION.md` for why.
>
> Two pages max. Specifics over generalities. Confidence and disagreement are part of the score — own both.

## Authorship declaration

I wrote this decision log entirely without AI assistance. The only tool I used on it was spell-check.

---

## Issues addressed

> Defects, security smells, architectural problems, missing pieces, scaling risks — anything you decided was worth your time. For each, fill in **every** sub-field. An empty field is a worse signal than an awkward answer.

- **Issue 1 — Auth con API keys **
  - What was wrong or weak: the merchant came from a header the client chose, so anyone could read and write another merchant’s data.
  - Shape of my improvement: the merchant comes only from the key, and the database stores only the hash.
  - **Confidence (1–10):** 8
  - **What would falsify this fix** (a specific scenario, input, or behavior that would prove me wrong): a new route or query that returns data without filtering by merchant_id.
  - **I disagreed with Claude on:** schema changes go in npm run migrate and never at server start
  - Alternatives I considered and rejected: NA

- **Issue 2 — Input validation **
  - What was wrong or weak: negative or infinite amounts 
  - Shape of my improvement: he handler never sees req, only what was already validated, and a test fails if a route is registered any other way.
  - **Confidence (1–10):** 8
  - **What would falsify this fix:** a route outside routes, where the guard does not look. 
  - **I disagreed with Claude on:** Some implementation 
  - Alternatives I considered and rejected:

- **Issue 3 — Refunds**
  - What was wrong or weak: refunds were added to revenue and counted as sales in metrics.
  - Shape of my improvement: one file with the rules, used by revenue and metrics.
  - **Confidence (1–10):** 9
  - **What would falsify this fix:** the business defining the rule differently.
  - **I disagreed with Claude on:** NA
  - Alternatives I considered and rejected: storing refunds with a negative amount

## Feature chosen

- **Feature:** order search with filters.
- **Why this one and not the others:** think about which other options the README gave and why this one seemed more useful for the merchant.
- **What I cut to ship it in budget:**
- **Confidence (1–10) that the shape I picked is the right one:** 8
- **What would change my mind:** merchants searching by something else.

## Things I noticed but did NOT fix

> Class-of-bug instances you saw and chose not to touch. For each, name the *reason* you cut it (scope / time / dependency / "needs a larger conversation").

- No rate limit 
- No request logging 
- Tests depend on the order they run in 
- No CI

## Docs / code I left alone deliberately

- metrics keeps its own read-only connection, only the money rules were connected to it

## What I'd do with another 6 hours

- CI that runs the tests on every push.

## Where I felt uncertain

> At least three places in this submission where you were not confident. Genuine uncertainty is a strength signal. "Nothing — I was confident everywhere" is itself a red flag and will be probed.

- The migrations: you feel there could be a better solution.
