import type { productCreateSchema, productListQuerySchema, productUpdateSchema } from '@stockroom/shared';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, PG_UNIQUE_VIOLATION, type Executor } from '../../db/client';
import { products, stockLevels, stores } from '../../db/schema';
import { HttpError, notFound } from '../../http/errors';

/** Total quantity across all stores. Reads stock_levels by its primary key (product_id, store_id). */
const totalStock = sql<number>`coalesce((select sum(sl.quantity) from ${stockLevels} sl where sl.product_id = ${products.id}), 0)::int`;

const listColumns = {
  id: products.id,
  sku: products.sku,
  name: products.name,
  category: products.category,
  priceCents: products.priceCents,
  reorderPoint: products.reorderPoint,
  totalStock,
  updatedAt: products.updatedAt,
};

const sortColumns = {
  name: products.name,
  sku: products.sku,
  price: products.priceCents,
  stock: totalStock,
  updated: products.updatedAt,
};

/** Escapes %, _ and \ so user input matches literally inside a LIKE pattern. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export const activeProduct = (tenantId: string, productId: string) =>
  and(eq(products.id, productId), eq(products.tenantId, tenantId), isNull(products.archivedAt));

export async function listProducts(db: Executor, tenantId: string, query: z.output<typeof productListQuerySchema>) {
  const conditions: (SQL | undefined)[] = [eq(products.tenantId, tenantId), isNull(products.archivedAt)];
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(or(ilike(products.name, pattern), ilike(products.sku, pattern), ilike(products.category, pattern)));
  }
  if (query.lowStock) {
    conditions.push(sql`${products.reorderPoint} > 0 and ${totalStock} <= ${products.reorderPoint}`);
  }
  const where = and(...conditions);
  const sortBy = sortColumns[query.sort];

  const [items, counts] = await Promise.all([
    db
      .select(listColumns)
      .from(products)
      .where(where)
      // The id tiebreaker keeps the order stable, so rows don't jump between pages.
      .orderBy(query.dir === 'desc' ? desc(sortBy) : asc(sortBy), asc(products.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(products).where(where),
  ]);

  return { items, total: counts[0]?.count ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getProduct(db: Executor, tenantId: string, productId: string) {
  const [product] = await db
    .select({ ...listColumns, createdAt: products.createdAt })
    .from(products)
    .where(activeProduct(tenantId, productId));
  if (!product) throw notFound('Product');

  // Every store is listed, including ones that have never held this product.
  const stock = await db
    .select({
      storeId: stores.id,
      storeName: stores.name,
      storeCode: stores.code,
      quantity: sql<number>`coalesce(${stockLevels.quantity}, 0)`,
    })
    .from(stores)
    .leftJoin(stockLevels, and(eq(stockLevels.storeId, stores.id), eq(stockLevels.productId, productId)))
    .where(eq(stores.tenantId, tenantId))
    .orderBy(asc(stores.name));

  return { ...product, stock };
}

function rethrowSkuTaken(err: unknown, sku: string | undefined): never {
  if (pgError(err)?.code === PG_UNIQUE_VIOLATION) {
    throw new HttpError(409, 'sku_taken', `Another product already uses the SKU ${sku}`);
  }
  throw err;
}

export async function createProduct(db: Executor, tenantId: string, input: z.output<typeof productCreateSchema>) {
  let id: string;
  try {
    const [created] = await db
      .insert(products)
      .values({ tenantId, ...input, category: input.category || null })
      .returning({ id: products.id });
    if (!created) throw new Error('Product insert returned nothing');
    id = created.id;
  } catch (err) {
    rethrowSkuTaken(err, input.sku);
  }
  return getProduct(db, tenantId, id);
}

export async function updateProduct(
  db: Executor,
  tenantId: string,
  productId: string,
  input: z.output<typeof productUpdateSchema>,
) {
  const changes = { ...input };
  if (changes.category !== undefined) changes.category = changes.category || null;

  let updated: { id: string } | undefined;
  try {
    [updated] = await db
      .update(products)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(activeProduct(tenantId, productId))
      .returning({ id: products.id });
  } catch (err) {
    rethrowSkuTaken(err, input.sku);
  }
  if (!updated) throw notFound('Product');
  return getProduct(db, tenantId, productId);
}

export async function archiveProduct(db: Executor, tenantId: string, productId: string) {
  const [archived] = await db
    .update(products)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(activeProduct(tenantId, productId))
    .returning({ id: products.id });
  if (!archived) throw notFound('Product');
}
