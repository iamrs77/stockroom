import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import type { ImportRow, RowError } from './columns';

export type ChunkContext = {
  tenantId: string;
  importId: string;
  userId: string | null;
  note: string;
};

export type ChunkResult = {
  created: number;
  updated: number;
  stockChanges: number;
  /** Rows rejected while applying, e.g. a new product without a price. */
  errors: RowError[];
  /** Rows actually applied. */
  applied: number;
};

/**
 * Applies one chunk of validated rows with a handful of set-based statements, whatever the chunk
 * size. Rows travel to Postgres as one JSON parameter and are unpacked with jsonb_to_recordset,
 * which avoids building queries with thousands of bind parameters.
 *
 * Locks are always taken in a fixed order (products by SKU, then stock by product and store), so
 * this can't deadlock with another writer that follows the same order.
 */
export async function applyChunk(tx: Tx, ctx: ChunkContext, rows: ImportRow[]): Promise<ChunkResult> {
  const result: ChunkResult = { created: 0, updated: 0, stockChanges: 0, errors: [], applied: 0 };
  if (rows.length === 0) return result;

  // 1. Which SKUs exist already? Lock them so their fields can't change underneath us.
  const skus = rows.map((r) => r.sku);
  const existing = await tx.execute<{ id: string; sku: string }>(sql`
    select id, sku from products
    where tenant_id = ${ctx.tenantId} and archived_at is null
      and sku in (select jsonb_array_elements_text(${JSON.stringify(skus)}::jsonb))
    order by sku
    for update`);
  const idsBySku = new Map(existing.rows.map((r) => [r.sku, r.id]));

  // 2. New products need a name and a price; updates can change any subset of fields.
  const toUpdate: ImportRow[] = [];
  const toCreate: ImportRow[] = [];
  for (const row of rows) {
    if (idsBySku.has(row.sku)) {
      toUpdate.push(row);
    } else if (row.name === undefined || row.priceCents === undefined) {
      result.errors.push({
        rowNumber: row.rowNumber,
        sku: row.sku,
        column: null,
        message: `${row.sku} is a new SKU, so it needs a name and a price`,
      });
    } else {
      toCreate.push(row);
    }
  }

  result.updated += await updateProducts(tx, ctx.tenantId, toUpdate);

  if (toCreate.length) {
    const inserted = await tx.execute<{ id: string; sku: string }>(sql`
      insert into products (tenant_id, sku, name, category, price_cents, reorder_point)
      select ${ctx.tenantId}::uuid, x.sku, x.name, x.category, x.price_cents, coalesce(x.reorder_point, 0)
      from jsonb_to_recordset(${productJson(toCreate)}::jsonb)
        as x(sku text, name text, category text, price_cents int, reorder_point int)
      order by x.sku
      on conflict (tenant_id, sku) where archived_at is null do nothing
      returning id, sku`);
    for (const r of inserted.rows) idsBySku.set(r.sku, r.id);
    result.created += inserted.rows.length;

    // Someone created one of these SKUs by hand while the import ran: update it instead.
    const raced = toCreate.filter((r) => !idsBySku.has(r.sku));
    if (raced.length) {
      result.updated += await updateProducts(tx, ctx.tenantId, raced);
      const found = await tx.execute<{ id: string; sku: string }>(sql`
        select id, sku from products
        where tenant_id = ${ctx.tenantId} and archived_at is null
          and sku in (select jsonb_array_elements_text(${JSON.stringify(raced.map((r) => r.sku))}::jsonb))`);
      for (const r of found.rows) idsBySku.set(r.sku, r.id);
    }
  }

  const applied = rows.filter((r) => idsBySku.has(r.sku));
  result.applied = applied.length;
  result.stockChanges = await setStock(tx, ctx, applied, idsBySku);
  return result;
}

const productJson = (rows: ImportRow[]) =>
  JSON.stringify(
    rows.map((r) => ({
      sku: r.sku,
      name: r.name ?? null,
      category: r.category ?? null,
      price_cents: r.priceCents ?? null,
      reorder_point: r.reorderPoint ?? null,
    })),
  );

/**
 * Updates only the fields a row provides, and only rows where something actually changes, so
 * re-running a chunk leaves updated_at alone and doesn't count phantom updates.
 */
async function updateProducts(tx: Tx, tenantId: string, rows: ImportRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const updated = await tx.execute(sql`
    update products p set
      name = coalesce(x.name, p.name),
      category = coalesce(x.category, p.category),
      price_cents = coalesce(x.price_cents, p.price_cents),
      reorder_point = coalesce(x.reorder_point, p.reorder_point),
      updated_at = now()
    from jsonb_to_recordset(${productJson(rows)}::jsonb)
      as x(sku text, name text, category text, price_cents int, reorder_point int)
    where p.tenant_id = ${tenantId} and p.archived_at is null and p.sku = x.sku
      and (p.name, p.category, p.price_cents, p.reorder_point) is distinct from
          (coalesce(x.name, p.name), coalesce(x.category, p.category),
           coalesce(x.price_cents, p.price_cents), coalesce(x.reorder_point, p.reorder_point))`);
  return updated.rowCount ?? 0;
}

/**
 * Sets each (product, store) to its counted quantity and records the difference in the ledger.
 * Unchanged quantities write nothing, which is what makes re-applying a chunk harmless.
 */
async function setStock(tx: Tx, ctx: ChunkContext, rows: ImportRow[], idsBySku: Map<string, string>): Promise<number> {
  const entries = rows
    .flatMap((row) => row.stock.map((s) => ({ product_id: idsBySku.get(row.sku)!, store_id: s.storeId, quantity: s.quantity })))
    .sort((a, b) => (a.product_id === b.product_id ? cmp(a.store_id, b.store_id) : cmp(a.product_id, b.product_id)));
  if (entries.length === 0) return 0;
  const entriesJson = JSON.stringify(entries);

  // a. Make sure a row exists for every (product, store), so every one of them can be locked.
  await tx.execute(sql`
    insert into stock_levels (tenant_id, product_id, store_id, quantity)
    select ${ctx.tenantId}::uuid, x.product_id, x.store_id, 0
    from jsonb_to_recordset(${entriesJson}::jsonb) as x(product_id uuid, store_id uuid)
    order by x.product_id, x.store_id
    on conflict (product_id, store_id) do nothing`);

  // b. Lock them in a fixed order and read the current quantities.
  const current = await tx.execute<{ product_id: string; store_id: string; quantity: number }>(sql`
    select sl.product_id, sl.store_id, sl.quantity
    from stock_levels sl
    join jsonb_to_recordset(${entriesJson}::jsonb) as x(product_id uuid, store_id uuid)
      on sl.product_id = x.product_id and sl.store_id = x.store_id
    order by sl.product_id, sl.store_id
    for update of sl`);
  const before = new Map(current.rows.map((r) => [`${r.product_id}:${r.store_id}`, r.quantity]));

  // c. Only quantities that differ produce a write and a ledger entry.
  const changes = entries
    .map((e) => ({ ...e, delta: e.quantity - (before.get(`${e.product_id}:${e.store_id}`) ?? 0) }))
    .filter((e) => e.delta !== 0);
  if (changes.length === 0) return 0;
  const changesJson = JSON.stringify(changes);

  await tx.execute(sql`
    update stock_levels sl set quantity = x.quantity, updated_at = now()
    from jsonb_to_recordset(${changesJson}::jsonb) as x(product_id uuid, store_id uuid, quantity int)
    where sl.product_id = x.product_id and sl.store_id = x.store_id`);

  await tx.execute(sql`
    insert into stock_movements (tenant_id, product_id, store_id, delta, balance_after, reason, note, user_id, import_id)
    select ${ctx.tenantId}::uuid, x.product_id, x.store_id, x.delta, x.quantity, 'import'::stock_reason,
           ${ctx.note}::text, ${ctx.userId}::uuid, ${ctx.importId}::uuid
    from jsonb_to_recordset(${changesJson}::jsonb) as x(product_id uuid, store_id uuid, quantity int, delta int)
    order by x.product_id, x.store_id`);

  return changes.length;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
