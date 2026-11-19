# 1. A modular monolith that can split into API and worker roles

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Stockroom has an interactive API and, from phase 2, slow background work (spreadsheet imports of up to ~100k rows). The live demo must run on a free tier, which gives one small web instance and usually no separate background worker.

Microservices would mean several deployables, network calls between them, and either distributed transactions or eventual consistency for things that are naturally one transaction, like "change stock and record it in the ledger".

## Decision

One codebase and one deployable, organised by module (`auth`, `stores`, `products`, `stock`, and later `imports`). Modules call each other through plain functions and share one Postgres database.

The process will have roles, chosen with an environment variable:

- `ROLE=all` (the default, used on the free tier) runs the HTTP API and the job worker in one process;
- `ROLE=api` and `ROLE=worker` run them separately, so each can be scaled on its own when hosting allows.

The queue (Redis, via BullMQ) is the only thing connecting the API and the worker, so splitting them later needs no code changes.

## Consequences

- One deploy, one log stream and real transactions. It fits the free tier.
- In `ROLE=all`, a heavy import competes with API requests for CPU. Imports are processed in chunks and yield between them, and the split roles are available when that stops being enough.
- Module boundaries are enforced by convention and review, not by the network. A module reaching into another's tables is the main risk to watch for.
