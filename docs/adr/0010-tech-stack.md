# 10. The tech stack, and what each choice was up against

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The earlier decision records explain how Stockroom is built: one deployable with API and worker roles ([ADR 0001](0001-modular-monolith.md)), a stock ledger ([ADR 0002](0002-stock-ledger.md)), free hosting ([ADR 0005](0005-free-tier-hosting.md)) and so on. They say which tools are used, but not why those tools rather than the usual alternatives. This record fills that gap, after the fact, with the reasons as they show up in the code.

Three constraints shaped every choice:

- **It must run for free**: one small web instance, a free Postgres that sleeps when idle, and a free Redis with a command limit ([ADR 0005](0005-free-tier-hosting.md)).
- **The interesting parts are in the data layer**: concurrent stock changes, bulk imports of 100,000 rows, and fast lists over large catalogues. Tools that hide SQL make those parts harder, not easier.
- **The design should be visible**: the queue, the outbox and the locks are meant to be read and reviewed, not hidden inside a platform.

## Decision

### TypeScript on Node.js, front to back

The server, the web app and the workers are all TypeScript. `packages/shared` holds the Zod schemas and the types inferred from them, so the API's validation rules and the web app's request types come from one source and can't drift apart. The server is bundled by esbuild into one file for production; the web app is built by Vite.

### PostgreSQL

The database does more than store rows here. The features Stockroom relies on:

- **Transactions and row locks** for the stock ledger and transfers, including `FOR UPDATE` in a fixed lock order ([ADR 0008](0008-transfers-and-lock-order.md)) and `FOR UPDATE SKIP LOCKED` so several outbox relays can share work ([ADR 0007](0007-outbox-and-webhooks.md)).
- **Constraints that keep data valid whatever the code does**: `CHECK (quantity >= 0)` on stock, and partial unique indexes such as "one SKU per business among active products", so an archived product's SKU can be reused.
- **Set-based bulk writes**: an import chunk travels as one JSON parameter and is unpacked with `jsonb_to_recordset`, with `ON CONFLICT … DO NOTHING` making re-runs harmless ([ADR 0006](0006-bulk-import-pipeline.md)).
- **Read performance features**: statement-level triggers that keep `total_stock` up to date, generated columns, partial indexes, and a trigram (`pg_trgm`) index for substring search ([ADR 0009](0009-read-performance.md)).

Turned down:

- **MySQL.** It has transactions and row locks, but no partial indexes and no statement-level triggers, both of which the design above uses.
- **MongoDB or another document store.** Stock, transfers and the ledger are relational and change together in one transaction; the reports join them. A document model would push those guarantees into application code.

Free hosted Postgres is easy to find (Neon here), which matters as much as the features.

### Drizzle ORM

Drizzle defines the schema in TypeScript, generates plain SQL migration files that are reviewed in the repo and applied on start-up, and gives typed queries. Its main draw is that it stays close to SQL:

- About 70 queries use its `sql` template for things a query builder doesn't express well: `jsonb_to_recordset`, `SKIP LOCKED`, keyset cursors and the trigger-maintained totals. Column references inside those templates are still typed (`${products.priceCents}`), so a renamed column breaks the build, not production.
- Types come straight from the TypeScript schema, with no separate generate step.

Turned down:

- **Prisma.** Its own schema language and generated client sit further from SQL. The hardest queries here would be raw SQL in Prisma anyway, kept apart from the client the rest of the code uses.
- **Kysely.** A very good typed query builder, but schema definitions and migration generation would need separate tooling.
- **Plain SQL with `pg`.** Full control, but no types on results and every migration written by hand.

### BullMQ on Redis

BullMQ provides what the import pipeline needs from a queue: one job per import (the job id is the import id, so a double upload can't queue it twice), retries with exponential backoff, detecting and recovering stalled jobs, and a concurrency limit per worker. Redis also carries pub/sub: import progress goes from the worker to every API process (one subscription per process, which keeps within the free plan's connection limit), and outbox "pokes" wake the relay straight away.

Postgres stays the source of truth: Redis only delivers work, so losing it delays imports but loses no data ([ADR 0006](0006-bulk-import-pipeline.md)).

Turned down:

- **A queue in Postgres (pg-boss).** It would remove a service. But it finds new jobs by querying Postgres every few seconds, which would keep Neon's free database awake around the clock and use up its compute hours; the app is designed to let it sleep when idle ([ADR 0005](0005-free-tier-hosting.md)). Live progress would also need `LISTEN`/`NOTIFY` in place of Redis pub/sub.
- **A hosted queue (Inngest, QStash, SQS).** It would hide the parts of the design this project sets out to show, and the free plans limit how many steps or messages can run.

### Express 5

Express 5 sends a rejected promise from an `async` handler to the error middleware, so routes simply `throw new HttpError(…)` with no wrapper. The middleware the app needs exists and is well maintained: Helmet, cookie-parser, express-rate-limit, pino-http, and `express.raw` for spreadsheet uploads.

Turned down: **Fastify**, which is faster and has schema validation built in, and **NestJS**, which brings its own module and dependency-injection system. Request handling isn't the bottleneck (the database is; see [performance.md](../performance.md)), and the module structure here is plain folders and functions ([ADR 0001](0001-modular-monolith.md)), so neither earned its extra concepts.

### A React single-page app built with Vite, not Next.js

Everything in Stockroom is behind sign-in, so there's nothing for search engines and no need for server rendering. The built app is static files that the Express server serves itself, on the same origin as the API: no second service to host, no CORS, and the session cookie just works. Asset names contain a content hash, so they're cached for a year. In development, Vite's server forwards `/api` to the back end.

Turned down: **Next.js**. It would need its own Node runtime or a serverless host, and the long-running parts (import workers, the outbox relay, server-sent events) need a persistent process anyway. Two runtimes would cost more than they save on a free tier.

### TanStack Query

Almost everything on screen is server data, and TanStack Query handles keeping it fresh:

- Shared cache keys let one feature refresh another's data: receiving a transfer refreshes products and low-stock alerts.
- The product list keeps the previous page on screen while the next one loads; the stock history pages with an infinite query.
- Polling turns on only while it's needed: every 3 s while an import is running, every 2 s while a webhook delivery is being retried.
- Import progress arriving over server-sent events is written straight into the cache, so every view of that import updates together.
- One place decides retries (never for a 4xx) and sends the visitor to sign-in on any 401.

Turned down: **fetching in `useEffect` by hand**, which means rewriting caching, deduplication and refresh in every page, and **a global store (Redux)** for server data, which leaves keeping it fresh to the app.

### React Router

Pages and their addresses are defined in one data router. The product list keeps its search, filters, sort and page in the URL (`useSearchParams`), so a filtered view can be bookmarked or shared.

Turned down: **TanStack Router**, whose fully typed routes are appealing, but React Router is the more widely known choice and the app has only a dozen routes.

### Tailwind CSS

Colours are tokens defined once in CSS (`@theme`), and dark mode swaps the token values, so components never mention a colour twice. The UI kit is about a dozen small components in `components/ui`, built from utility classes, with no runtime styling library.

Turned down: **a component library (MUI, Chakra)**, which is heavy and makes every app look like its default theme, and **CSS modules**, which mean naming and maintaining a stylesheet per component.

### Vitest and Supertest against a real Postgres and Redis

The bugs that matter most here are concurrency bugs: two sales racing for the last unit, two people receiving the same transfer, two people using one invite link. Those only show up against a real database with real locks, so the tests start a real Postgres (`embedded-postgres`, no Docker needed) and use a real Redis, and drive the API over HTTP with Supertest. Several tests run requests at the same moment on purpose.

Vitest runs TypeScript and ES modules directly, with the same resolver settings (such as the `@/` import alias) as Vite.

Turned down: **mocking the database or testing against SQLite**. Both would pass while the real locking, constraints and triggers went untested.

## Consequences

- **Two data services to run**: Postgres and Redis, locally (Redis runs in WSL), in CI and in production. Redis is the one a Postgres queue could remove, at the cost described above.
- **SQL knowledge is required.** Much of the important logic is in SQL (set-based imports, triggers, keyset paging). That's deliberate, and it's where the performance numbers come from, but it's less approachable than an ORM-only codebase.
- **Every tool here is mainstream** in the Node and React world, so the code is easy to hand over. None of it ties Stockroom to one host: moving from Render, Neon and Upstash to other providers needs only new connection settings.
- **The front end and back end are separate builds** that one server ships together. A full-stack framework would merge them, but couldn't host the workers.
