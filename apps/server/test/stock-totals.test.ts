import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { tenants } from '@/db/schema';
import { processImport } from '@/modules/imports/process';
import { createImport } from '@/modules/imports/service';
import { createProduct, setupTestApp, signUp, silentLogger } from './helpers';

const { app, db } = setupTestApp();

/** Products whose stored total disagrees with the sum of their stock levels. Should always be empty. */
async function mismatches(tenantId: string) {
  const result = await db.execute<{ sku: string; total_stock: number; actual: number }>(sql`
    select p.sku, p.total_stock, coalesce(sum(sl.quantity), 0)::int as actual
    from products p left join stock_levels sl on sl.product_id = p.id
    where p.tenant_id = ${tenantId}
    group by p.id
    having p.total_stock <> coalesce(sum(sl.quantity), 0)`);
  return result.rows;
}

describe('stored stock totals', () => {
  it('stay equal to the sum of stock levels through every kind of change', async () => {
    const owner = await signUp(app);
    const tenantId = owner.user.tenant.id;
    const wh = (await owner.agent.post('/api/stores').send({ name: 'Warehouse', code: 'WH' })).body;
    const a = await createProduct(owner.agent, { sku: 'A', name: 'Apple' });
    const b = await createProduct(owner.agent, { sku: 'B', name: 'Banana' });
    const adjust = (productId: string, storeId: string, delta: number) =>
      owner.agent.post(`/api/products/${productId}/stock-adjustments`).send({ storeId, delta, reason: delta > 0 ? 'received' : 'sold' });

    // Manual changes: adds create rows, removals update them.
    await adjust(a.id, owner.mainStore.id, 20);
    await adjust(a.id, wh.id, 5);
    await adjust(a.id, owner.mainStore.id, -3);
    await adjust(b.id, owner.mainStore.id, 8);

    // Many concurrent changes in two stores.
    await Promise.all(Array.from({ length: 10 }, (_, i) => adjust(b.id, i % 2 ? wh.id : owner.mainStore.id, 2)));

    // Transfers: send, receive one short, cancel another.
    const send = (lines: { productId: string; quantity: number }[]) =>
      owner.agent.post('/api/transfers').send({ fromStoreId: owner.mainStore.id, toStoreId: wh.id, lines });
    const t1 = await send([{ productId: a.id, quantity: 4 }, { productId: b.id, quantity: 3 }]);
    await owner.agent.post(`/api/transfers/${t1.body.id}/receive`).send({ lines: [{ productId: a.id, receivedQuantity: 3 }] });
    const t2 = await send([{ productId: a.id, quantity: 2 }]);
    await owner.agent.post(`/api/transfers/${t2.body.id}/cancel`);

    // An import: updates existing stock (set to counts) and creates a new product with stock.
    const { summary } = await createImport(db, {
      tenantId,
      userId: owner.user.id,
      fileName: 'count.csv',
      content: Buffer.from('sku,name,price,stock:MAIN,stock:WH\nA,,,7,0\nC,Cherry,3,11,4\n'),
      format: 'csv',
    });
    await processImport(db, summary.id, { chunkSize: 1, logger: silentLogger });

    expect(await mismatches(tenantId)).toEqual([]);
    const list = await owner.agent.get('/api/products').query({ sort: 'sku' });
    expect(list.body.items.map((p: { sku: string; totalStock: number }) => [p.sku, p.totalStock])).toEqual([
      ['A', 7], // set by the import: 7 in MAIN, 0 in WH
      ['B', 28], // 8 + 10 x 2. The 3 sent to WH all arrived, so moving them doesn't change the total.
      ['C', 15],
    ]);
  });

  it('survive deleting a whole business, whose stock rows cascade away', async () => {
    const owner = await signUp(app);
    const product = await createProduct(owner.agent);
    await owner.agent
      .post(`/api/products/${product.id}/stock-adjustments`)
      .send({ storeId: owner.mainStore.id, delta: 5, reason: 'received' });
    await expect(db.delete(tenants).where(eq(tenants.id, owner.user.tenant.id))).resolves.toBeDefined();
  });
});
