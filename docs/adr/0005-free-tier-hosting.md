# 5. Free-tier hosting: one service, with Postgres for everything durable

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The live demo has to cost nothing to run, permanently. That rules out AWS (new accounts get time-limited credits, not a free tier) and anything else that needs a paid plan once a trial ends.

Typical free tiers in 2026 provide a single small web service that sleeps when idle, a managed Postgres with around 0.5 GB of storage, and a managed Redis with around 30 MB. Separate background workers and object storage are usually paid. Exact limits change often and should be checked at deploy time.

## Decision

- **One service** serves the web app, the API and (from phase 2) the job worker. See [ADR 0001](0001-modular-monolith.md).
- **Postgres holds everything durable**: data, sessions, idempotency keys and, from phase 2, uploaded import files (as `bytea`, deleted once an import finishes). File storage sits behind a small interface, so S3-compatible storage can replace it if a free option is ever worth adding.
- **Redis holds only things that can be rebuilt**: queues and caches. Losing it delays imports but loses no data.
- **Migrations run on start-up**, because free hosts have no separate release step and there is one instance.
- **The demo creates a sandbox business per visitor** (planned), seeded with sample data and deleted after 24 hours, so visitors can't vandalise each other's demo and storage stays bounded.

## Consequences

- Hosting costs nothing, and the deployment is easy to explain.
- The first request after the service sleeps is slow (a cold start). The README says so.
- Storing files in Postgres uses database storage, so uploads are capped in size and deleted after processing.
- Moving to paid hosting later is configuration, not a rewrite: split the roles, point `DATABASE_URL` and `REDIS_URL` at bigger instances, and swap the file store.
