import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { outboxEvents } from '../src/db/schema';
import { createImport } from '../src/modules/imports/service';
import { processImport } from '../src/modules/imports/process';
import { applyStockChange } from '../src/modules/stock/service';
import { createProduct, setupTestApp, signUp, silentLogger } from './helpers';

const { app, db } = setupTestApp();

async function setup() {
  const owner = await signUp(app);
  const product = await createProduct(owner.agent, { sku: 'TEA', name: 'Earl Grey', reorderPoint: 5 });
  const adjust = (delta: number, storeId = owner.mainStore.id) =>
    owner.agent
      .post(`/api/products/${product.id}/stock-adjustments`)
      .send({ storeId, delta, reason: delta > 0 ? 'received' : 'sold' });
  const events = async () =>
    (
      await db
        .select({ type: outboxEvents.type, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.tenantId, owner.user.tenant.id))
        .orderBy(asc(outboxEvents.id))
    ).filter((e) => e.type.startsWith('stock.'));
  const alerts = async () => (await owner.agent.get('/api/alerts')).body;
  return { ...owner, product, adjust, events, alerts };
}

describe('low-stock alerts', () => {
  it('opens one alert when stock falls to the reorder point, and resolves it on restock', async () => {
    const t = await setup();
    await t.adjust(12);
    expect((await t.alerts()).total).toBe(0);

    await t.adjust(-7); // 5 left: at the reorder point
    const open = await t.alerts();
    expect(open.items).toEqual([expect.objectContaining({ sku: 'TEA', stock: 5, reorderPoint: 5, stockAtOpen: 5 })]);

    await t.adjust(-2); // still low: no second alert
    expect((await t.alerts()).total).toBe(1);

    await t.adjust(10); // 13: back above
    expect((await t.alerts()).total).toBe(0);

    expect((await t.events()).map((e) => [e.type, (e.payload as { stock: number }).stock])).toEqual([
      ['stock.low', 5],
      ['stock.restocked', 13],
    ]);
  });

  it('writes no event for a change that was rolled back', async () => {
    const t = await setup();
    await t.adjust(6);
    const rejected = await t.adjust(-20); // insufficient stock: the transaction rolls back
    expect(rejected.status).toBe(409);
    expect(await t.events()).toEqual([]);
  });

  it('opens or resolves alerts when the reorder point changes, and resolves them on archive', async () => {
    const t = await setup();
    await t.adjust(8);
    await t.agent.patch(`/api/products/${t.product.id}`).send({ reorderPoint: 10 });
    expect((await t.alerts()).total).toBe(1);
    await t.agent.delete(`/api/products/${t.product.id}`);
    expect((await t.alerts()).total).toBe(0);
    expect((await t.events()).map((e) => e.type)).toEqual(['stock.low', 'stock.restocked']);
  });

  it('raises exactly one alert when sales in two stores race', async () => {
    const t = await setup();
    const wh = await t.agent.post('/api/stores').send({ name: 'Warehouse', code: 'WH' });
    await t.adjust(6);
    await t.adjust(6, wh.body.id);
    expect(await t.events()).toEqual([]); // 12 in total: nothing low yet

    // Two sales of 4, in different stores. Either one alone leaves 8 (fine); together they leave 4
    // (low). To make them truly overlap, each waits just before committing until the other has got
    // that far too (or 300 ms pass), so neither commits before both have run the low-stock check.
    let arrived = 0;
    let release!: () => void;
    const bothIn = new Promise<void>((resolve) => (release = resolve));
    const barrier = async () => {
      if (++arrived === 2) release();
      await Promise.race([bothIn, new Promise((resolve) => setTimeout(resolve, 300))]);
    };
    const sell = (storeId: string) =>
      applyStockChange(
        db,
        { tenantId: t.user.tenant.id, productId: t.product.id, storeId, delta: -4, reason: 'sold' },
        { beforeCommit: barrier },
      );
    await Promise.all([sell(t.mainStore.id), sell(wh.body.id)]);

    // Each sale locks the product row first, so the second waits until the first commits (after its
    // 300 ms wait) and then sees that sale. Without the lock, both run the check while the other's
    // sale is still uncommitted, both see 8, and the alert is lost: the test fails every time.
    expect((await t.alerts()).items).toEqual([expect.objectContaining({ stock: 4 })]);
    expect((await t.events()).map((e) => e.type)).toEqual(['stock.low']);
  });

  it('checks every product an import touches, in the same transaction', async () => {
    const t = await setup();
    const { summary } = await createImport(db, {
      tenantId: t.user.tenant.id,
      userId: t.user.id,
      fileName: 'count.csv',
      content: Buffer.from('sku,name,price,reorder_point,stock:MAIN\nTEA,,,,3\nNEW-1,New thing,2,10,50\nNEW-2,Low thing,2,10,1\n'),
      format: 'csv',
    });
    await processImport(db, summary.id, { chunkSize: 2, logger: silentLogger });
    expect((await t.alerts()).items.map((a: { sku: string }) => a.sku).sort()).toEqual(['NEW-2', 'TEA']);

    const types = (
      await db.select({ type: outboxEvents.type }).from(outboxEvents).where(eq(outboxEvents.tenantId, t.user.tenant.id))
    ).map((e) => e.type);
    expect(types.filter((x) => x === 'stock.low')).toHaveLength(2);
    expect(types).toContain('import.completed');
  });

  it('records transfer events with the change', async () => {
    const t = await setup();
    const wh = await t.agent.post('/api/stores').send({ name: 'Warehouse', code: 'WH' });
    await t.adjust(9);
    const sent = await t.agent
      .post('/api/transfers')
      .send({ fromStoreId: t.mainStore.id, toStoreId: wh.body.id, lines: [{ productId: t.product.id, quantity: 6 }] });
    // In transit, stock can't be sold anywhere, so 3 on hand is low.
    expect((await t.alerts()).total).toBe(1);
    await t.agent.post(`/api/transfers/${sent.body.id}/receive`).send({});
    expect((await t.alerts()).total).toBe(0);

    const types = (
      await db.select({ type: outboxEvents.type }).from(outboxEvents).where(eq(outboxEvents.tenantId, t.user.tenant.id)).orderBy(asc(outboxEvents.id))
    ).map((e) => e.type);
    // Each transaction syncs alerts, then records the transfer event.
    expect(types).toEqual(['stock.low', 'transfer.sent', 'stock.restocked', 'transfer.received']);
  });
});
