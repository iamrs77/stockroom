# Performance

How the product list went from 1.6 seconds to 6 milliseconds on a 100,000-product catalogue, what it cost, and how to check it yourself.

The rule throughout: **measure, change one thing, measure again**, and explain every number with a query plan before trusting it.

## Method

- **Data.** One business with 100,000 products and 3 stores, loaded through the real import pipeline (`npm run bench` creates it). The database also held other businesses, so indexes and statistics weren't artificially small.
- **Load.** [autocannon](https://github.com/mcollina/autocannon), 10 concurrent connections, 10 s per scenario after a 2 s warm-up, against the production build (`node dist/main.js`). Logging was at `warn`.
- **Machine.** One laptop running everything: Intel Core i9-13900H (14 cores), 32 GB RAM, Windows 11, Postgres 18 (embedded, default settings) and Redis 8 (WSL). The load generator shares the machine, so absolute numbers are optimistic about network latency and pessimistic about CPU. Compare the before and after columns, not these numbers with another machine's.

```bash
npm run bench -- --url http://localhost:3100 --label before   # on the old build
npm run bench -- --url http://localhost:3100 --label after --compare before
npm run explain                                               # query plans for the list's main queries
```

## Results

| Scenario | Before p50 | After p50 | After p99 | Throughput before → after |
|---|--:|--:|--:|--:|
| Low-stock filter | 1,651 ms | **6 ms** | 11 ms | 5 → 1,474 req/s |
| Sort by stock | 902 ms | **6 ms** | 10 ms | 11 → 1,397 req/s |
| Page 2,000 by number (`OFFSET`) | 477 ms | 24 ms | 37 ms | 20 → 401 req/s |
| Page 2,001 by cursor | — | **7 ms** | 13 ms | 1,367 req/s |
| First page | 13 ms | 6 ms | 16 ms | 713 → 1,418 req/s |
| Search for a SKU | 93 ms | 19 ms | 29 ms | 106 → 520 req/s |
| Search "honey" | 45 ms | 19 ms | 33 ms | 215 → 486 req/s |
| Product detail | 6 ms | 6 ms | 15 ms | 1,312 → 1,343 req/s |
| Stock change (write) | 11 ms | 12 ms | 25 ms | 841 → 594–808 req/s |

Every list query now runs in under 3 ms inside the database (`npm run explain`). The rest of each request's time is HTTP, the session lookup and JSON.

## What changed, and why

### 1. A stored stock total, kept correct by the database

**Problem.** Sorting or filtering by stock added up every product's `stock_levels` rows on each request, so 100,000 sums before the first row could be returned. The plan was a full scan with a sub-query per row.

**Change.** `products.total_stock`, maintained by **statement-level triggers** on `stock_levels`. Each statement's changes are summed per product from the trigger's transition tables and applied with one `UPDATE`. An import chunk touching 3,000 stock rows fires the trigger once, not 3,000 times. Because it's in the database, no code path can forget it. A test runs every kind of stock change (sales, concurrent changes, transfers, imports, deletes) and checks every product's total against its stock rows.

Writers already lock the product row first ([ADR 0008](adr/0008-transfers-and-lock-order.md)), so the trigger's update adds no new lock ordering.

**Sort index.** `(tenant_id, total_stock, id)` over active products. Sort by stock is now an index scan that stops after 26 rows.

### 2. A low-stock column, because the planner can't estimate a comparison between two columns

**First attempt.** A partial index on `total_stock <= reorder_point`. The filter was still 35 ms: Postgres walked the name index and threw away 96,559 rows to find 26.

**Why.** Postgres has no statistics for a comparison between two columns, so it assumes about a third of rows match (33,000 here; the truth was 27). With that many expected matches, walking the name index and filtering looks cheaper than using the small index. Refreshing statistics (`ANALYZE`) changed nothing.

**Change.** `low_stock`, a stored generated column (`reorder_point > 0 and total_stock <= reorder_point`), with a partial index on `(tenant_id, name, id) WHERE low_stock`. Postgres keeps exact statistics for a boolean column, so it now knows only 27 rows match. The plan became an index-only scan of those 27 rows: **0.15 ms**.

### 3. Keyset paging

**Problem.** `OFFSET 49,975` reads and discards 49,975 rows.

**Change.** Pages carry a cursor: the sort value and id of the row at the page edge, in Postgres's own text form so timestamps keep their microseconds. The next page is `WHERE (sort_value, id) > (cursor)`, which seeks straight into the sort's index. Every sort has an index on `(tenant_id, value, id)`, and the id makes the order total. A test walks every page forwards and then backwards, for three sorts with many ties, and checks that each product appears exactly once, in order. Page numbers still work through `OFFSET`, but the app pages by cursor.

### 4. Counting stops at 10,000

**Problem.** "Showing 1–25 of 100,000" meant counting 100,000 rows on every page: 16 ms, and growing with the catalogue.

**Change.** Count at most 10,001 rows and show "10,000+" beyond that, the way search engines show "about". The count now costs at most about 2 ms however big the catalogue gets. Small catalogues, which is most shops, still show exact totals.

### 5. Trigram search

**Problem.** `ILIKE '%term%'` can't use a b-tree index, so every search read every product.

**Change.** `search_text`, a stored generated column (lower-cased name, SKU and category) with a `pg_trgm` GIN index. A SKU search went from a full scan to a bitmap index scan (93 → 19 ms end to end).

### 6. Refresh statistics after big loads

A 100,000-row import leaves the planner's statistics stale until autovacuum catches up. Imports of 10,000+ rows now run `ANALYZE products, stock_levels` when they finish, and the migration that added the new columns ends with `ANALYZE`.

## What it cost

Reads happen constantly and imports happen occasionally, so this trade was made deliberately. These are its costs.

| | Before | After |
|---|--:|--:|
| 100,000-row import, fresh database | 27.0 s (3,698 rows/s) | 39.5 s (2,530 rows/s) |
| Stock change throughput | 841 req/s | 594–808 req/s (varies run to run) |
| Indexes on `products` | 3 | 9 |

- **Imports are about 46% slower.** Measured on two fresh, empty databases with the same file; the previous build was checked out from git and run alongside. Each product row now has 9 indexes (including the trigram index), and an import writes each new product twice: once to create it, and once when the trigger sets its total. Because `total_stock` is indexed, that second write can't be a cheap in-place update ("HOT" update) and must touch every index.
- **Writes are slightly slower** for the same reason. Median latency barely moved (11 → 12 ms).

## A regression found along the way

The first version of the update trigger joined the transition tables' old and new rows on (product, store). Transition tables have no indexes or statistics, so Postgres compared every old row with every new one: **16 million comparisons per 4,000-row import chunk, 144 ms each time.** A 100,000-row import took 66 s.

It showed up only because import time was measured after the read work, and `EXPLAIN ANALYZE` on a replayed chunk pointed straight at it. The join wasn't needed: a product's change is the sum of its new quantities minus the sum of its old ones. Stacking both sets with `UNION ALL` and grouping once is linear. The trigger now takes 38 ms per chunk (migration `0007`).

## Why there's no Redis cache

Caching was on the roadmap, but every read is now 6–19 ms end to end and under 3 ms in the database, with an index for every list path. A cache would add invalidation on every stock change, import chunk and transfer, plus a new way to show stale stock, in exchange for a few milliseconds. It isn't worth it at this scale.

It becomes worth it when **database CPU** becomes the limit, which the metrics below would show first. The first thing to cache would be the product list's first page per business, keyed by a per-business version number that each stock-changing transaction increments.

## Known limits

- **Search time grows with the whole database, not one business.** The trigram index covers every business's products. Between two runs, the database grew from about 200,000 to 400,000 products, and searches went from 10–13 ms to 19 ms. Fixes, if it matters: a composite GIN index on `(tenant_id, search_text)` (with the `btree_gin` extension, available on Neon), or partitioning `products` by tenant.
- **Deleting a large business is slow.** Cascading 280,000 products with their stock and history took 108 s locally. The planned demo businesses (phase 5) are small. Anything large should be deleted in batches in the background.
- **Write throughput is noisy on a laptop** (594–808 req/s across three identical runs). Treat single-run write numbers with caution.

## Watching it in production

`GET /metrics` serves Prometheus metrics. It needs `Authorization: Bearer $METRICS_TOKEN`, and is off in production without a token.

| Metric | What to watch for |
|---|---|
| `stockroom_http_request_duration_seconds{route}` | p99 by route pattern, e.g. `/api/products` |
| `stockroom_outbox_unpublished_events` | Should stay near 0; growth means the relay is stuck |
| `stockroom_queue_jobs{queue,state}` | Waiting imports or webhooks piling up |
| `stockroom_db_pool_connections{state="waiting"}` | Requests waiting for a database connection: the first sign the database, not Node, is the limit |
| `stockroom_import_rows_processed_total` | Import throughput |
| `stockroom_webhook_attempts_total{outcome}` | Failing receivers |
| `stockroom_nodejs_eventloop_lag_seconds` | CPU-bound work blocking requests |
