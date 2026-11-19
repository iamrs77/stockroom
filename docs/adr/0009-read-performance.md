# 9. Read performance: stored totals, keyset paging and capped counts

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

With 100,000 products in one business, the product list's main paths were slow under 10 concurrent users. Sorting by stock took 902 ms, the low-stock filter 1.6 s, and page 2,000 477 ms. All of it was computed per request: summing stock for every product, `OFFSET` scans, exact counts and unindexed substring search. Measurements and plans are in [performance.md](../performance.md).

## Decision

1. **Store each product's total stock**, maintained by statement-level triggers on `stock_levels`, rather than adding it up per request. The database keeps it correct for every writer. A test checks it after every kind of change.
2. **Store "is low on stock" as a generated boolean column** with a partial index. Postgres can't estimate a comparison between two columns, but it keeps exact statistics for a boolean.
3. **Page by cursor** (`(sort value, id) > cursor`), with an index per sort on `(tenant_id, value, id)`. Page numbers still work, through `OFFSET`.
4. **Count at most 10,001 rows** and show "10,000+" beyond that.
5. **Trigram index** on a generated, lower-cased `search_text` column for substring search.
6. **No cache.** The database answers every list query in under 3 ms; see the performance doc for when that would change.

Rejected alternatives:

- **Maintaining the total in application code.** Every writer (manual changes, imports, transfers, future code) would have to remember it. One forgotten path means silently wrong totals.
- **A materialised view refreshed periodically.** Stale between refreshes, and refreshing 100,000 rows to change one is wasteful.
- **Row-level triggers.** One trigger call per stock row, so 3,000 per import chunk, against one per statement.
- **Estimated counts from the planner** (`EXPLAIN` row estimates). They can be far off for filtered queries, and "about 98,000" is no more useful to a person than "10,000+".

## Consequences

- The list's main paths are 2–275× faster at p50, and every one is now an index scan.
- **Imports are about 46% slower** (27 s → 40 s for 100,000 rows on a fresh database), and write throughput is somewhat lower. Products carry 9 indexes instead of 3, and updating the indexed total can't be a cheap in-place update. Reads are far more frequent than imports, so the trade is worth it, and it's recorded rather than hidden.
- **Triggers are logic outside the application code.** They're documented in the migration and in [architecture.md](../architecture.md), and the invariant test fails if they ever drift.
- **Trigger SQL needs the same care as any query.** The first version joined transition tables (16 million comparisons per chunk); a measurement caught it.
