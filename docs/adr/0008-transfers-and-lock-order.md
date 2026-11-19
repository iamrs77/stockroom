# 8. Two-step transfers, and one lock order for every writer

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Stores send stock to each other. Goods spend time on a truck, sometimes arrive short, and sometimes a transfer is cancelled. Meanwhile, sales, imports and other transfers change the same products concurrently.

Several operations now lock several rows each: an import chunk locks up to 1,000 products and their stock, a transfer locks its products and two stores' stock. If two writers take the same locks in different orders, Postgres eventually finds a deadlock and kills one of them.

## Decision

### Transfers have two steps and a forward-only state

- **Send** (`in_transit`): stock leaves the source store immediately, with a `transfer_out` ledger entry per product. Every line is checked before anything changes, so the error lists *every* product that's short, not just the first.
- **Receive** (`received`): the receiver counts what arrived. That amount goes into the destination store with a `transfer_in` entry, and any shortfall is recorded on the line.
- **Cancel** (`cancelled`): the stock goes back to the source store.

The status only moves forward, and every move is a guarded `UPDATE … WHERE status = 'in_transit'`. If two people press Receive at once, the second waits for the first's row lock, re-checks the condition, finds the transfer already received, and gets `409`. Tested with three simultaneous receives: one succeeds, and stock is added once. Create, receive and cancel also accept an `Idempotency-Key` ([ADR 0003](0003-idempotency-keys.md)).

Transfers are numbered per business (TR-0001, TR-0002, …) from a counter on the tenant row. The row lock makes concurrent transfers take turns for a number, which is plenty for a small retailer.

**Low stock counts stock on hand, not in transit.** Stock on a truck can't be sold in any store, so sending a big transfer can open a low-stock alert that resolves when the transfer is received. That's deliberate: it's the same definition the product list uses.

### One lock order

Every writer takes row locks in this order:

1. the transfer row (receive, cancel)
2. products, by id
3. stock levels, by (product, store)
4. low-stock alerts

Manual stock changes lock the product first. Imports lock their chunk's products by id (they used to lock them by SKU), and transfers lock products by id, then stock by product. With one global order, a cycle can't form, so imports, transfers and sales can't deadlock with one another.

Locking the **product** row first does more than prevent deadlocks: it makes the low-stock check correct. Two sales of the same product in *different* stores touch different stock rows. Without a shared lock, each transaction would check the total before the other's sale committed, and both would miss that the product went low. With the product lock, the second waits, then sees the first's sale.

A test forces this race with a barrier that holds both transactions open just before commit. It passes with the lock and fails every time without it.

## Consequences

- Changes to one product are serialised, even across stores. At a small retailer's volume that costs nothing measurable. A very hot product would contend on its row, which is the price of a correct total.
- New code that writes stock must follow the lock order. The order is written at the top of the transfers service and in the architecture doc.
- In-transit stock is visible on the product page ("N in transit"), but isn't counted towards low stock.
