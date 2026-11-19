import {
  uuidSchema,
  type productCreateSchema,
  type productListQuerySchema,
  type productUpdateSchema,
} from '@stockroom/shared';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, PG_UNIQUE_VIOLATION, type Db, type Executor } from '../../db/client';
import { products, stockLevels, stores, transferLines, transfers } from '../../db/schema';
import { HttpError, notFound } from '../../http/errors';
import { syncLowStockAlerts } from '../events/outbox';

const listColumns = {
  id: products.id,
  sku: products.sku,
  name: products.name,
  category: products.category,
  priceCents: products.priceCents,
  reorderPoint: products.reorderPoint,
  // A stored column kept in step by triggers on stock_levels, so it can be sorted and filtered with an index.
  totalStock: products.totalStock,
  updatedAt: products.updatedAt,
};

/** Each sort has an index on (tenant_id, column, id) over active products. `type` casts cursor values back. */
const sorts = {
  name: { column: products.name, type: 'text' },
  sku: { column: products.sku, type: 'text' },
  price: { column: products.priceCents, type: 'int' },
  stock: { column: products.totalStock, type: 'int' },
  updated: { column: products.updatedAt, type: 'timestamptz' },
} as const;

/**
 * The page total is exact up to this many products, then shown as "10,000+". Counting stops there,
 * so a page costs the same whether a business has ten thousand products or ten million.
 */
export const COUNT_CAP = 10_000;

/** Escapes %, _ and \ so user input matches literally inside a LIKE pattern. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export const activeProduct = (tenantId: string, productId: string) =>
  and(eq(products.id, productId), eq(products.tenantId, tenantId), isNull(products.archivedAt));

/**
 * A cursor is the sort value and id of a row at the edge of a page. The value travels as Postgres's
 * own text form, so timestamps keep their microseconds and a page boundary never drops or repeats a row.
 */
type Cursor = [value: string, id: string];
const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
function decodeCursor(raw: string): Cursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && uuidSchema.safeParse(value[1]).success) {
      return value as Cursor;
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, 'invalid_cursor', 'This page link is no longer valid. Go back to the first page.');
}

/**
 * Lists products. Paging is keyset ("rows after this one"), so page 2,000 costs the same as page 1:
 * the database seeks straight to the cursor in the sort's index instead of reading and discarding
 * every earlier row the way OFFSET does. Asking for a page by number still works, using OFFSET.
 */
export async function listProducts(
  db: Executor,
  tenantId: string,
  query: z.output<typeof productListQuerySchema>,
) {
  const conditions: (SQL | undefined)[] = [eq(products.tenantId, tenantId), isNull(products.archivedAt)];
  if (query.q) {
    // search_text is lower(name sku category) with a trigram index, so this doesn't read every row.
    conditions.push(sql`${products.searchText} like ${`%${escapeLike(query.q.toLowerCase())}%`}`);
  }
  if (query.lowStock) {
    // A stored boolean with its own statistics and partial index (products_low_stock_idx).
    conditions.push(sql`${products.lowStock}`);
  }
  const filter = and(...conditions);

  const { column, type } = sorts[query.sort];
  const cursorRaw = query.after ?? query.before;
  const backwards = !query.after && !!query.before;
  // Reading forwards in ascending order, or backwards in descending order, walks the index upwards.
  const upwards = (query.dir === 'desc') === backwards;
  let where = filter;
  if (cursorRaw) {
    const [value, id] = decodeCursor(cursorRaw);
    where = and(filter, sql`(${column}, ${products.id}) ${sql.raw(upwards ? '>' : '<')} (${value}::${sql.raw(type)}, ${id}::uuid)`);
  }
  const byNumber = !cursorRaw && query.page > 1;

  const [rows, counts] = await Promise.all([
    db
      .select({ ...listColumns, cursorValue: sql<string>`${column}::text` })
      .from(products)
      .where(where)
      // The id tiebreaker makes the order total, so rows never jump between pages.
      .orderBy(...(upwards ? [asc(column), asc(products.id)] : [desc(column), desc(products.id)]))
      .limit(query.pageSize + 1) // one extra row says whether there's another page
      .offset(byNumber ? (query.page - 1) * query.pageSize : 0),
    db.execute<{ count: number }>(
      sql`select count(*)::int as count from (select 1 from ${products} where ${filter} limit ${COUNT_CAP + 1}) capped`,
    ),
  ]);
  const counted = counts.rows[0]?.count ?? 0;

  const more = rows.length > query.pageSize;
  const page = rows.slice(0, query.pageSize);
  if (backwards) page.reverse();
  const first = page[0];
  const last = page.at(-1);
  return {
    items: page.map(({ cursorValue: _, ...item }) => item),
    total: Math.min(counted, COUNT_CAP),
    totalCapped: counted > COUNT_CAP,
    pageSize: query.pageSize,
    page: cursorRaw ? null : query.page,
    // Going backwards, the page we came from is always next. Going forwards, the extra row says.
    nextCursor: last && (backwards || more) ? encodeCursor([last.cursorValue, last.id]) : null,
    prevCursor: first && (backwards ? more : !!cursorRaw || byNumber) ? encodeCursor([first.cursorValue, first.id]) : null,
  };
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

  const [transit] = await db
    .select({ units: sql<number>`coalesce(sum(${transferLines.quantity}), 0)::int` })
    .from(transferLines)
    .innerJoin(transfers, eq(transfers.id, transferLines.transferId))
    .where(and(eq(transferLines.productId, productId), eq(transfers.tenantId, tenantId), eq(transfers.status, 'in_transit')));

  return { ...product, stock, inTransit: transit?.units ?? 0 };
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
  db: Db,
  tenantId: string,
  productId: string,
  input: z.output<typeof productUpdateSchema>,
) {
  const changes = { ...input };
  if (changes.category !== undefined) changes.category = changes.category || null;

  await db.transaction(async (tx) => {
    let updated: { id: string } | undefined;
    try {
      [updated] = await tx
        .update(products)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(activeProduct(tenantId, productId))
        .returning({ id: products.id });
    } catch (err) {
      rethrowSkuTaken(err, input.sku);
    }
    if (!updated) throw notFound('Product');
    // A new reorder point can open or resolve a low-stock alert without any stock moving.
    if (input.reorderPoint !== undefined) await syncLowStockAlerts(tx, tenantId, [productId]);
  });
  return getProduct(db, tenantId, productId);
}

export async function archiveProduct(db: Db, tenantId: string, productId: string) {
  await db.transaction(async (tx) => {
    const [archived] = await tx
      .update(products)
      .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
      .where(activeProduct(tenantId, productId))
      .returning({ id: products.id });
    if (!archived) throw notFound('Product');
    await syncLowStockAlerts(tx, tenantId, [productId]); // an archived product's alert is resolved
  });
}
