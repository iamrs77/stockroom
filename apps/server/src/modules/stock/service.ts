import type { movementsQuerySchema, StockReason } from '@stockroom/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, PG_CHECK_VIOLATION, type Db, type Executor } from '@/db/client';
import { products, stockLevels, stockMovements, stores, users } from '@/db/schema';
import { HttpError, notFound } from '@/http/errors';
import { syncLowStockAlerts } from '@/modules/events/outbox';
import { activeProduct } from '@/modules/products/service';

export type StockChange = {
  tenantId: string;
  productId: string;
  storeId: string;
  delta: number;
  reason: StockReason;
  note?: string | null;
  userId?: string | null;
};

const movementColumns = {
  id: stockMovements.id,
  storeId: stockMovements.storeId,
  storeName: stores.name,
  delta: stockMovements.delta,
  balanceAfter: stockMovements.balanceAfter,
  reason: stockMovements.reason,
  note: stockMovements.note,
  userName: users.name,
  createdAt: stockMovements.createdAt,
};

const insufficientStock = () =>
  new HttpError(409, 'insufficient_stock', 'There is not enough stock in this store for that change');

/**
 * Applies one stock change and records it in the ledger, in a single transaction.
 *
 * The product row is locked first (the global lock order is products, then stock levels), so
 * concurrent changes to the same product queue up instead of overwriting each other, and the
 * low-stock check at the end sees every committed change. The quantity >= 0 check constraint
 * rejects any change that would take stock below zero, so there's no read-then-write race to get wrong.
 */
export async function applyStockChange(
  db: Db,
  change: StockChange,
  /** Test hook: runs inside the transaction, after the low-stock check and before the commit. */
  hooks: { beforeCommit?: () => Promise<void> } = {},
) {
  return db.transaction(async (tx) => {
    await assertBelongsToTenant(tx, change);

    let quantity: number;
    try {
      const level = change.delta > 0 ? await addStock(tx, change) : await removeStock(tx, change);
      if (!level) throw insufficientStock(); // nothing held in this store yet
      quantity = level.quantity;
    } catch (err) {
      if (pgError(err)?.code === PG_CHECK_VIOLATION) throw insufficientStock();
      throw err;
    }

    const [inserted] = await tx
      .insert(stockMovements)
      .values({
        tenantId: change.tenantId,
        productId: change.productId,
        storeId: change.storeId,
        delta: change.delta,
        balanceAfter: quantity,
        reason: change.reason,
        note: change.note || null,
        userId: change.userId ?? null,
      })
      .returning({ id: stockMovements.id });
    if (!inserted) throw new Error('Movement insert returned nothing');

    const [movement] = await tx
      .select(movementColumns)
      .from(stockMovements)
      .innerJoin(stores, eq(stores.id, stockMovements.storeId))
      .leftJoin(users, eq(users.id, stockMovements.userId))
      .where(eq(stockMovements.id, inserted.id));

    await syncLowStockAlerts(tx, change.tenantId, [change.productId]);
    await hooks.beforeCommit?.();
    return { quantity, movement };
  });
}

/** Adds stock, creating the row the first time this store holds the product. */
async function addStock(tx: Executor, change: StockChange) {
  const [level] = await tx
    .insert(stockLevels)
    .values({ tenantId: change.tenantId, productId: change.productId, storeId: change.storeId, quantity: change.delta })
    .onConflictDoUpdate({
      target: [stockLevels.productId, stockLevels.storeId],
      set: { quantity: sql`${stockLevels.quantity} + ${change.delta}`, updatedAt: sql`now()` },
    })
    .returning({ quantity: stockLevels.quantity });
  return level;
}

/**
 * Removes stock with a plain UPDATE. An upsert can't do this: Postgres checks constraints on the
 * row an INSERT proposes before it detects the conflict, so inserting a negative quantity fails
 * even when the existing row has plenty of stock.
 */
async function removeStock(tx: Executor, change: StockChange) {
  const [level] = await tx
    .update(stockLevels)
    .set({ quantity: sql`${stockLevels.quantity} + ${change.delta}`, updatedAt: sql`now()` })
    .where(and(eq(stockLevels.productId, change.productId), eq(stockLevels.storeId, change.storeId)))
    .returning({ quantity: stockLevels.quantity });
  return level;
}

async function assertBelongsToTenant(tx: Executor, change: StockChange) {
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(activeProduct(change.tenantId, change.productId))
    .for('update');
  if (!product) throw notFound('Product');

  const [store] = await tx
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, change.storeId), eq(stores.tenantId, change.tenantId)));
  if (!store) {
    throw new HttpError(400, 'validation_failed', 'Some fields are invalid', [
      { path: 'storeId', message: 'Unknown store' },
    ]);
  }
}

/**
 * A product's stock history, newest first. Uses keyset pagination on the movement id, so a page
 * costs the same however deep the history goes, and new movements don't shift later pages.
 */
export async function listMovements(
  db: Executor,
  tenantId: string,
  productId: string,
  { before, limit }: z.output<typeof movementsQuerySchema>,
) {
  const [product] = await db.select({ id: products.id }).from(products).where(activeProduct(tenantId, productId));
  if (!product) throw notFound('Product');

  const rows = await db
    .select(movementColumns)
    .from(stockMovements)
    .innerJoin(stores, eq(stores.id, stockMovements.storeId))
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .where(
      and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.productId, productId),
        before ? lt(stockMovements.id, before) : undefined,
      ),
    )
    .orderBy(desc(stockMovements.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (items.at(-1)?.id ?? null) : null;
  return { items, nextCursor };
}
