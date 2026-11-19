# 5. Free-tier hosting: one service, with Postgres for everything durable

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The live demo has to cost nothing to run, permanently. That rules out AWS (new accounts get time-limited credits, not a free tier) and anything else that needs a paid plan once a trial ends.

Typical free tiers in 2026 provide a single small web service that sleeps when idle, a managed Postgres with around 0.5 GB of storage, and a managed Redis with around 30 MB. Separate background workers and object storage are usually paid. Exact limits change often and should be checked at deploy time.

## Decision

- **One service** serves the web app, the API and (from phase 2) the job worker. See [ADR 0001](0001-modular-monolith.md).
- **Postgres holds everything durable**: data, sessions, idempotency keys and uploaded import files. Files are kept as `bytea` in an `import_files` table and deleted once the import ends. Moving them to S3-compatible storage would change two places: where the upload is saved, and where the worker reads it.
- **Redis holds only things that can be rebuilt**: queues and caches. Losing it delays imports but loses no data.
- **Migrations run on start-up**, because free hosts have no separate release step and there is one instance.
- **The demo creates a sandbox business per visitor**, seeded with sample data and deleted after 24 hours, so visitors can't vandalise each other's demo and storage stays bounded. Creation is rate-limited per IP and capped in total. Demo imports have a smaller row limit, and open sign-ups are off on the public demo.

## Providers (chosen in phase 5, November 2026)

| Need | Chosen | Rejected, and why |
|---|---|---|
| Node host | **Render** free web service: 512 MB, sleeps after 15 idle minutes, 750 hours a month | Koyeb (now needs a card hold), Fly.io and Railway (no lasting free plan) |
| Postgres | **Neon** free: 1 GB, 100 CU-hours a month, sleeps after 5 idle minutes | Render Postgres (deleted after 30 days) |
| Redis | **Upstash** free: persistent, BullMQ-compatible, 500,000 commands a month | Render Key Value (in-memory only, so queues are lost on restart), Redis Cloud free (can be deleted after 14 idle days), Aiven Valkey (powered off when idle) |

Two free plans count something BullMQ and background timers consume by default, and both were budgeted ([deploy.md](../deploy.md#how-it-stays-free)):

- **Upstash commands.** Idle BullMQ workers poll every 5 s by default, which is about 500,000 commands a month for two workers. Polling every 60 s with stalled checks every 2 minutes brings the worst case (awake all of Render's 750 hours) to about 315,000.
- **Neon compute.** Any query within 5 minutes keeps the database awake. The safety-net timers (sweepers, outbox poll) run every 30 minutes in production, so an idle app lets Neon sleep. Real work triggers its own queries, so nothing waits on those timers.

## Consequences

- Hosting costs nothing, and the deployment is a blueprint file plus two connection strings.
- The first request after the service sleeps is slow (about a minute). The README says so.
- A deploy, a sleep or a restart mid-import is normal on this setup, not an edge case. The import pipeline's checkpoints and graceful hand-back ([ADR 0006](0006-bulk-import-pipeline.md)) are what make that safe.
- Safety nets run less often in production (every 30 minutes), so a lost job takes longer to be noticed. That's acceptable because nothing normally depends on them.
- Storing files in Postgres uses database storage, so uploads are capped in size and deleted after processing.
- Moving to paid hosting later is configuration, not a rewrite: split the roles, point `DATABASE_URL` and `REDIS_URL` at bigger instances, put the timers back to their defaults, and swap the file store.
