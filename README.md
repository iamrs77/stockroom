# Stockroom

Inventory for small retailers: products, stock across several stores, a full history of every change, and spreadsheet imports of up to 100,000 rows that run in the background. Built to be correct under concurrency and failure, and to run entirely on free hosting.

![Product list with search, sorting and low-stock badges](docs/images/products.png)

![An import of 30,000 rows in progress, with live counts of new products, updates, stock changes and skipped rows](docs/images/import-progress.png)

> **Status:** phases 1 and 2 of 5 are done: accounts, stores, products, the stock ledger, and the background import pipeline. See the [roadmap](#roadmap).

## What's interesting here

- **Imports that survive a crash.** Each chunk of 1,000 rows commits together with its checkpoint, so a crashed import resumes exactly where it stopped. In a test, the server was hard-killed partway through a 100,000-row import. After a restart the import finished, and its 197,463 stock changes matched its ledger exactly. ([ADR 0006](docs/adr/0006-bulk-import-pipeline.md))
- **Postgres records the work, the queue delivers it.** An upload is saved in Postgres before it's queued. If Redis loses the job, a sweeper queues it again. Two workers can never apply the same chunk, because the checkpoint doubles as a fencing token.
- **Fast on cheap hardware.** A 100,000-row file imports in about 27 seconds on a laptop: each chunk is a handful of set-based SQL statements, not a query per row. Importing the same file again changes nothing, because stock columns are counts, not changes.
- **A stock ledger that can't oversell.** Every change is an append-only movement written in the same transaction as the balance. A `CHECK (quantity >= 0)` constraint rejects overselling: in tests, 12 simultaneous sales against 5 units give exactly 5 successes. ([ADR 0002](docs/adr/0002-stock-ledger.md))
- **Safe retries.** Stock changes accept an `Idempotency-Key`, and identical uploads are recognised by their hash, so retried requests don't apply anything twice. ([ADR 0003](docs/adr/0003-idempotency-keys.md))
- **Live progress** over server-sent events, with one Redis subscription per server process instead of one per viewer.
- **Written down.** [Architecture](docs/architecture.md) with diagrams, a failure-modes table, measured performance and a scaling plan, plus [decision records](docs/adr) with the trade-offs.

## Run it locally

No Docker needed: `npm run db` starts a real PostgreSQL server from an npm package.

**Requirements:** Node.js 22.12 or later, and Redis 6.2 or later on `localhost:6379`. On Windows, Redis runs in WSL: `wsl -d Ubuntu -- redis-server --daemonize yes`.

```bash
npm install
npm run dev        # starts Postgres (port 5433), the API and import worker (3000), and the web app (5173)
```

In a second terminal, add the demo data once:

```bash
npm run db:seed
```

Open http://localhost:5173 and choose **Fill in the demo account** (`demo@stockroom.app` / `stockroom-demo`), or create your own account.

To try a big import, generate a file for the demo business's stores and upload it on the **Imports** page:

```bash
npm run sample:import -- --rows 100000     # writes .data/imports/sample-100000.csv
```

Postgres keeps its data in `.data/postgres`. Delete that folder to start fresh.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Postgres, API, worker and web app together, with reload on change |
| `npm run db` | Only the local Postgres server |
| `npm run db:seed` | Recreates the demo business: 3 stores, 136 products, opening stock |
| `npm run sample:import` | Writes a large import file with a few deliberate mistakes (`--rows`, `--stores`, `--bad`) |
| `npm test` | API and import tests against a throwaway Postgres and your local Redis |
| `npm run typecheck` | Type-checks every package |
| `npm run build` | Builds the web app and bundles the server |
| `npm start` | Runs the production build: one process serving the API and web app, and processing imports |
| `npm run db:generate` | Generates a migration after a change to `apps/server/src/db/schema.ts` |

## Stack

| | |
|---|---|
| **API** | Node.js, Express 5, TypeScript, Drizzle ORM, PostgreSQL, Zod, pino |
| **Background jobs** | BullMQ on Redis; CSV via `csv-parse`, Excel via `read-excel-file` |
| **Web** | React 19, React Router, TanStack Query, Tailwind CSS, Vite; live progress over server-sent events |
| **Tests** | Vitest and Supertest against real Postgres and Redis (no mocks) |

## Project layout

```
apps/
  server/            Express API and import worker; serves the built web app in production
    src/modules/     auth, stores, products, stock, imports: routes and queries per area
    src/http/        auth, idempotency, validation and error middleware
    src/db/          schema, migrations, seed data
    drizzle/         generated SQL migrations
    test/            API, import and failure tests
  web/               React app
packages/
  shared/            Zod schemas and types shared by the API and the web app
docs/
  architecture.md    how it works, failure modes, measurements, scaling plan
  adr/               decision records
scripts/
  dev-db.ts          local Postgres without Docker
  generate-import.ts sample import files
```

## Roadmap

- [x] **Phase 1: foundation.** Accounts and businesses, stores, products, the stock ledger, idempotency keys, tests and CI
- [x] **Phase 2: bulk imports.** CSV and Excel files of up to 100,000 rows, processed in the background in chunks that resume after a crash, with live progress and a per-row problem report
- [ ] **Phase 3: operations.** Transfers between stores, low-stock alerts sent through a transactional outbox, staff accounts
- [ ] **Phase 4: performance.** A `total_stock` column, keyset pagination and trigram search, measured against the [phase 2 baseline](docs/architecture.md#measured-so-far); load tests; metrics
- [ ] **Phase 5: live demo.** Free deployment, with a sandbox business per visitor that is deleted after a day
