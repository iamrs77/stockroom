import { sql } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { outboxEvents } from '@/db/schema';

/**
 * Writes an event to the outbox. Call it inside the transaction that makes the change, so the
 * event exists exactly when the change commits: never for a rolled-back change, never lost after a
 * committed one. After committing, call `poke()` from AppDeps so the relay sends it promptly.
 */
export async function recordEvent(tx: Executor, tenantId: string, type: string, data: Record<string, unknown>) {
  await tx.insert(outboxEvents).values({ tenantId, type, payload: data });
}

/**
 * Brings low-stock alerts in line with current stock for some products, and records an event for
 * every alert opened (stock.low) or resolved (stock.restocked).
 *
 * It compares state rather than reacting to deltas: "is this product low right now, and is an
 * alert open?" Calling it twice changes nothing the second time, and it works the same after a
 * manual change, a transfer or an import chunk of a thousand products.
 *
 * Callers must already hold the products' row locks (the lock order is products, then stock), so
 * no concurrent change to these products can commit between reading the totals and writing the alerts.
 */
export async function syncLowStockAlerts(tx: Executor, tenantId: string, productIds: string[]) {
  if (productIds.length === 0) return;
  await tx.execute(sql`
    with totals as (
      -- total_stock is maintained by triggers on stock_levels, and already includes this
      -- transaction's changes (statement triggers fire before the next statement runs).
      select p.id, p.sku, p.name, p.reorder_point, p.archived_at, p.total_stock as stock
      from products p
      where p.tenant_id = ${tenantId}
        and p.id in (select (jsonb_array_elements_text(${JSON.stringify(productIds)}::jsonb))::uuid)
    ),
    opened as (
      insert into low_stock_alerts (tenant_id, product_id, stock_at_open, reorder_point_at_open)
      select ${tenantId}::uuid, t.id, t.stock, t.reorder_point
      from totals t
      where t.archived_at is null and t.reorder_point > 0 and t.stock <= t.reorder_point
      on conflict (product_id) where resolved_at is null do nothing
      returning product_id
    ),
    resolved as (
      update low_stock_alerts a
      set resolved_at = now(), stock_at_resolve = t.stock
      from totals t
      where a.product_id = t.id and a.resolved_at is null
        and (t.archived_at is not null or t.reorder_point = 0 or t.stock > t.reorder_point)
      returning a.product_id
    )
    insert into outbox_events (tenant_id, type, payload)
    select ${tenantId}::uuid, e.type,
           jsonb_build_object('productId', t.id, 'sku', t.sku, 'name', t.name, 'stock', t.stock, 'reorderPoint', t.reorder_point)
    from (
      select product_id, 'stock.low' as type from opened
      union all
      select product_id, 'stock.restocked' as type from resolved
    ) e
    join totals t on t.id = e.product_id`);
}
