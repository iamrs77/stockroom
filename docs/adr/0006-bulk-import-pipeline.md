# 6. Bulk imports: Postgres records the work, the queue delivers it

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Retailers keep their catalogue and stock counts in spreadsheets. An import can be up to 100,000 rows and touch several hundred thousand stock levels. It has to:

- keep the API responsive while it runs;
- survive a crash, a deploy or a free instance being paused partway through, without applying rows twice or skipping any;
- report bad rows precisely instead of failing the whole file;
- stop one business's big file from starving everyone else's;
- show live progress;
- fit free tiers: one small instance, ~30 Redis connections, no object storage.

## Decision

### Postgres is the source of truth; Redis only delivers work

The upload request does three cheap things: it hashes the file, saves the file and an `imports` row in one transaction, and adds a BullMQ job whose id is the import id. It then returns `202 Accepted`. Parsing happens in the worker.

If adding the job fails (Redis down), the upload still succeeds. A **sweeper** in every worker periodically re-adds any unfinished import that hasn't moved for two minutes. Re-adding is a no-op while the job exists, because the job id is the import id. It only rescues jobs the queue really lost. This is the transactional-outbox idea, without a separate outbox table: the `imports` row is the outbox.

### Each chunk commits its own checkpoint

Rows are applied in chunks of 1,000. Each chunk's product writes, stock writes, ledger entries, error rows and the checkpoint (`processed_rows`) commit in **one transaction**. After a crash, the next attempt skips exactly the committed rows: nothing is applied twice and nothing is skipped.

The checkpoint is also a **fencing token**. A chunk commits only if `processed_rows` still holds the value its worker last saw (`UPDATE … WHERE processed_rows = $expected`), and that update runs first, so a worker that has lost the race stops before writing anything. If BullMQ ever hands a stalled job to a second worker while the first is still alive, only one of them can make progress.

### Stock columns are counts, so re-applying is harmless

A `stock:QSW` cell is the counted quantity in that store, not a change. The import sets stock to the count and records the difference in the ledger. Re-applying a row finds a difference of zero and writes nothing. Products are updated only when a field actually changes (`IS DISTINCT FROM`). So even if a checkpoint were lost, re-running is safe: delivery is at least once, and the writes are idempotent.

### Set-based SQL, one JSON parameter per statement

A chunk is applied with a fixed number of statements, however many rows it has. Rows travel as one JSON parameter and are unpacked with `jsonb_to_recordset`, which avoids queries with thousands of bind parameters. Locks are taken in a fixed order (products by SKU, then stock by product and store), so imports can't deadlock with each other or with manual stock changes.

Adding stock rows can't use `INSERT … ON CONFLICT DO UPDATE` with the counted value alone, because the delta is needed for the ledger. So the chunk inserts any missing stock rows with quantity 0, locks all of them with `SELECT … FOR UPDATE`, computes deltas, then updates the changed rows and writes the ledger.

### One running import per business

A partial unique index allows one `processing` import per tenant. A worker that picks up a second import for a busy tenant puts the job back on a short delay, without using up a retry, and moves on to another tenant's work.

### Live progress over server-sent events

After each chunk, the worker publishes the import's summary to a single Redis channel. Each API process holds **one** subscription to that channel and fans updates out to the open SSE streams. Every update is the full summary, not a delta, so a client that misses one loses nothing. The stream starts with the current state from Postgres, so a reconnect also loses nothing. The browser also polls slowly as a safety net.

SSE rather than WebSockets: updates only flow one way, SSE works through ordinary HTTP proxies, the browser reconnects by itself, and the session cookie is sent with no extra work.

### Files live in Postgres while they're needed

The upload is stored as `bytea` and deleted when the import ends. Free tiers have no object storage, and a 100,000-row CSV is about 6 MB.

## Consequences

Measured on a laptop (production build, local Postgres and Redis, one worker):

- **Upload:** a 6 MB, 100,000-row CSV gets its `202` in about 280 ms.
- **First import:** the same file processes in about 27 s (~3,700 rows/s), creating 99,786 products and 296,761 stock changes, with 214 deliberately broken rows reported.
- **Re-import:** the same file again makes **0** changes in about 6 s.
- **Crash recovery:** the server was hard-killed at 32,000 rows and restarted. The import resumed from its checkpoint and finished. Its stock-change count equals its ledger rows exactly (197,463), and no (product, store) pair was changed twice.

Trade-offs:

- **Recovery after a crash takes about a minute.** BullMQ waits for the dead worker's job lock (30 s) to expire before handing the job on, and checks for stalled jobs every 30 s. Shorter settings recover faster but cost more Redis traffic, which matters on a free plan's command limits. A graceful shutdown (a deploy) hands the job back immediately instead.
- **Every attempt re-reads the file from the start.** It needs to, to rebuild the duplicate-SKU check. Reading is cheap next to writing: the no-op re-import of 100,000 rows takes about 6 s.
- **Excel files are parsed in memory** (`read-excel-file`, not a streaming parser). This is fine within the 20 MB limit, but it's the first thing to change for bigger files.
- **A stock count overwrites sales made after the count was taken.** That's what a stock count means. The ledger shows the adjustment, so it can be traced.
- **Stored problems are capped at 1,000 per import.** The count keeps going, and the report says when it was cut short.
