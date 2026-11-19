import type { LowStockAlert } from '@stockroom/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import { lowStockAlerts, products, stockLevels } from '../../db/schema';
import { getAuth } from '../../http/auth';

export function alertsRouter({ db }: AppDeps) {
  const router = Router();

  /** Open low-stock alerts, oldest first: those have waited longest for a reorder. */
  router.get('/', async (req, res) => {
    const { tenant } = getAuth(req);
    const items = await db
      .select({
        id: lowStockAlerts.id,
        productId: products.id,
        sku: products.sku,
        name: products.name,
        stock: sql<number>`coalesce((select sum(${stockLevels.quantity}) from ${stockLevels} where ${stockLevels.productId} = ${products.id}), 0)::int`,
        reorderPoint: products.reorderPoint,
        stockAtOpen: lowStockAlerts.stockAtOpen,
        openedAt: lowStockAlerts.openedAt,
      })
      .from(lowStockAlerts)
      .innerJoin(products, eq(products.id, lowStockAlerts.productId))
      .where(and(eq(lowStockAlerts.tenantId, tenant.id), isNull(lowStockAlerts.resolvedAt)))
      .orderBy(asc(lowStockAlerts.openedAt))
      .limit(500);
    res.json({ items: items as unknown as LowStockAlert[], total: items.length });
  });

  return router;
}
