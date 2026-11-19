import type { LowStockAlert } from '@stockroom/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { lowStockAlerts, products } from '@/db/schema';

/** Open low-stock alerts, oldest first: those have waited longest for a reorder. */
export async function listOpenAlerts(db: Db, tenantId: string) {
  const items = await db
    .select({
      id: lowStockAlerts.id,
      productId: products.id,
      sku: products.sku,
      name: products.name,
      stock: products.totalStock,
      reorderPoint: products.reorderPoint,
      stockAtOpen: lowStockAlerts.stockAtOpen,
      openedAt: lowStockAlerts.openedAt,
    })
    .from(lowStockAlerts)
    .innerJoin(products, eq(products.id, lowStockAlerts.productId))
    .where(and(eq(lowStockAlerts.tenantId, tenantId), isNull(lowStockAlerts.resolvedAt)))
    .orderBy(asc(lowStockAlerts.openedAt))
    .limit(500);
  return { items: items as unknown as LowStockAlert[], total: items.length };
}
