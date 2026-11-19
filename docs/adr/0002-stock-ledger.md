# 2. A stock ledger with a derived balance, guarded by a database constraint

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Retailers need to know how much stock they have now, and also *why* it changed: received, sold, damaged, corrected, imported or transferred. Several people (and, later, background imports) change the same stock at the same time. Stock must never go below zero, and no change may be lost.

Options considered:

1. **Store only a quantity.** Simple, but there's no history and no way to audit or rebuild it.
2. **Store only a ledger** and add it up on every read. A perfect audit trail, but reads get slower as history grows, and "is there enough stock?" needs a lock over a range of rows.
3. **Store both**: an append-only ledger plus a current balance, written in the same transaction.

## Decision

Option 3.

- `stock_movements` is append-only. Each row has `delta`, `reason`, `balance_after`, who made it and when.
- `stock_levels` has one row per (product, store) with the current `quantity` and `CHECK (quantity >= 0)`.
- A change runs in one transaction: update `stock_levels` with `quantity = quantity + delta` (adding uses an upsert, removing a plain `UPDATE`), then insert the movement with the `balance_after` the database returned.

The database does the arithmetic while it holds the row lock. Concurrent changes to the same (product, store) queue up behind each other, and the check constraint rejects any change that would oversell. The application never reads a balance and then writes a new one.

## Consequences

- Reading current stock is a primary-key lookup. Reading history is an index range scan, paged with a cursor.
- `balance_after` makes the ledger self-checking: each row's balance should equal the previous row's balance plus its delta. A scheduled consistency check can verify this.
- Very hot rows (one product selling constantly in one store) serialise on one row lock. That's correct behaviour, and far beyond a small retailer's volume.
- Removing stock can't use the same upsert as adding it. Postgres checks constraints on the row an `INSERT` proposes before resolving `ON CONFLICT`, so a negative proposed quantity fails even when the existing row has stock. A test caught this, and the code documents it.
