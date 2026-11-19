import { randomUUID } from 'node:crypto';
import type { TransferDetail } from '@stockroom/shared';
import { describe, expect, it } from 'vitest';
import { createProduct, setupTestApp, signUp } from './helpers';

const { app } = setupTestApp();

/** A business with two stores, two products, and stock in the main store. */
async function setup() {
  const owner = await signUp(app);
  const wh = await owner.agent.post('/api/stores').send({ name: 'Warehouse', code: 'WH' });
  const mug = await createProduct(owner.agent, { sku: 'MUG', name: 'Mug' });
  const tote = await createProduct(owner.agent, { sku: 'TOTE', name: 'Tote' });
  for (const [product, qty] of [
    [mug, 10],
    [tote, 4],
  ] as const) {
    await owner.agent
      .post(`/api/products/${product.id}/stock-adjustments`)
      .send({ storeId: owner.mainStore.id, delta: qty, reason: 'received' });
  }
  const stockOf = async (productId: string) => {
    const res = await owner.agent.get(`/api/products/${productId}`);
    const byCode = Object.fromEntries(res.body.stock.map((s: { storeCode: string; quantity: number }) => [s.storeCode, s.quantity]));
    return { ...byCode, inTransit: res.body.inTransit };
  };
  const send = (lines: { productId: string; quantity: number }[], headers: Record<string, string> = {}) =>
    owner.agent
      .post('/api/transfers')
      .set(headers)
      .send({ fromStoreId: owner.mainStore.id, toStoreId: wh.body.id, lines, note: 'Weekly restock' });
  return { ...owner, warehouseId: wh.body.id as string, mug, tote, stockOf, send };
}

describe('transfers', () => {
  it('takes stock out of the sending store and marks it in transit', async () => {
    const t = await setup();
    const res = await t.send([
      { productId: t.mug.id, quantity: 3 },
      { productId: t.tote.id, quantity: 4 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      number: 1,
      status: 'in_transit',
      fromStore: { code: 'MAIN' },
      toStore: { code: 'WH' },
      lineCount: 2,
      totalUnits: 7,
      createdBy: 'Owner',
    });
    expect(await t.stockOf(t.mug.id)).toEqual({ MAIN: 7, WH: 0, inTransit: 3 });
    expect(await t.stockOf(t.tote.id)).toEqual({ MAIN: 0, WH: 0, inTransit: 4 });

    const history = await t.agent.get(`/api/products/${t.mug.id}/movements`);
    expect(history.body.items[0]).toMatchObject({ reason: 'transfer_out', delta: -3, balanceAfter: 7, note: 'TR-0001 to WH' });
  });

  it('numbers transfers per business', async () => {
    const t = await setup();
    const first = await t.send([{ productId: t.mug.id, quantity: 1 }]);
    const second = await t.send([{ productId: t.mug.id, quantity: 1 }]);
    expect([first.body.number, second.body.number]).toEqual([1, 2]);
    const other = await setup();
    expect((await other.send([{ productId: other.mug.id, quantity: 1 }])).body.number).toBe(1);
  });

  it('lists every short line and changes nothing', async () => {
    const t = await setup();
    const res = await t.send([
      { productId: t.mug.id, quantity: 11 },
      { productId: t.tote.id, quantity: 5 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([
      { path: 'lines.0.quantity', message: 'Only 10 in stock at MAIN' },
      { path: 'lines.1.quantity', message: 'Only 4 in stock at MAIN' },
    ]);
    expect(await t.stockOf(t.mug.id)).toEqual({ MAIN: 10, WH: 0, inTransit: 0 });
  });

  it('rejects sending to the same store, duplicate lines and unknown products', async () => {
    const t = await setup();
    const same = await t.agent
      .post('/api/transfers')
      .send({ fromStoreId: t.mainStore.id, toStoreId: t.mainStore.id, lines: [{ productId: t.mug.id, quantity: 1 }] });
    expect(same.body.error.details).toContainEqual({ path: 'toStoreId', message: 'Choose a different store to send to' });

    const dupes = await t.send([
      { productId: t.mug.id, quantity: 1 },
      { productId: t.mug.id, quantity: 1 },
    ]);
    expect(dupes.body.error.details).toContainEqual({ path: 'lines', message: 'Each product can only be on a transfer once' });

    const unknown = await t.send([{ productId: randomUUID(), quantity: 1 }]);
    expect(unknown.body.error.details).toEqual([{ path: 'lines.0.productId', message: 'Unknown product' }]);
  });

  it('receives what arrived and records any shortfall', async () => {
    const t = await setup();
    const sent = await t.send([
      { productId: t.mug.id, quantity: 5 },
      { productId: t.tote.id, quantity: 2 },
    ]);
    const res = await t.agent
      .post(`/api/transfers/${sent.body.id}/receive`)
      .send({ lines: [{ productId: t.mug.id, receivedQuantity: 4 }] }); // one mug broke; totes arrived as sent
    expect(res.status).toBe(200);
    const detail = res.body as TransferDetail;
    expect(detail).toMatchObject({ status: 'received', receivedBy: 'Owner' });
    expect(detail.lines.map((l) => [l.sku, l.quantity, l.receivedQuantity])).toEqual([
      ['MUG', 5, 4],
      ['TOTE', 2, 2],
    ]);
    expect(await t.stockOf(t.mug.id)).toEqual({ MAIN: 5, WH: 4, inTransit: 0 });

    const history = await t.agent.get(`/api/products/${t.mug.id}/movements`);
    expect(history.body.items[0]).toMatchObject({ reason: 'transfer_in', delta: 4, storeName: 'Warehouse', note: 'TR-0001 from MAIN' });
  });

  it('refuses to receive more than was sent', async () => {
    const t = await setup();
    const sent = await t.send([{ productId: t.mug.id, quantity: 2 }]);
    const res = await t.agent
      .post(`/api/transfers/${sent.body.id}/receive`)
      .send({ lines: [{ productId: t.mug.id, receivedQuantity: 3 }] });
    expect(res.status).toBe(400);
    expect((await t.agent.get(`/api/transfers/${sent.body.id}`)).body.status).toBe('in_transit');
  });

  it('receives a transfer only once, even when two people press Receive together', async () => {
    const t = await setup();
    const sent = await t.send([{ productId: t.mug.id, quantity: 5 }]);
    const results = await Promise.all([1, 2, 3].map(() => t.agent.post(`/api/transfers/${sent.body.id}/receive`).send({})));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('transfer_closed');
    expect(await t.stockOf(t.mug.id)).toEqual({ MAIN: 5, WH: 5, inTransit: 0 });
  });

  it('puts the stock back when a transfer is cancelled, and closes it', async () => {
    const t = await setup();
    const sent = await t.send([{ productId: t.mug.id, quantity: 6 }]);
    const res = await t.agent.post(`/api/transfers/${sent.body.id}/cancel`);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelledBy: 'Owner' });
    expect(await t.stockOf(t.mug.id)).toEqual({ MAIN: 10, WH: 0, inTransit: 0 });
    expect((await t.agent.post(`/api/transfers/${sent.body.id}/receive`).send({})).status).toBe(409);
  });

  it('applies a retried request once when it carries an Idempotency-Key', async () => {
    const t = await setup();
    const key = randomUUID();
    const first = await t.send([{ productId: t.mug.id, quantity: 2 }], { 'Idempotency-Key': key });
    const retry = await t.send([{ productId: t.mug.id, quantity: 2 }], { 'Idempotency-Key': key });
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    expect(await t.stockOf(t.mug.id)).toMatchObject({ MAIN: 8, inTransit: 2 });
  });

  it('lists transfers newest first, filtered by status', async () => {
    const t = await setup();
    const a = await t.send([{ productId: t.mug.id, quantity: 1 }]);
    await t.send([{ productId: t.mug.id, quantity: 1 }]);
    await t.agent.post(`/api/transfers/${a.body.id}/receive`).send({});
    expect((await t.agent.get('/api/transfers')).body.items.map((x: { number: number }) => x.number)).toEqual([2, 1]);
    expect((await t.agent.get('/api/transfers').query({ status: 'received' })).body.items.map((x: { number: number }) => x.number)).toEqual([1]);
  });

  it("keeps each business's transfers private", async () => {
    const t = await setup();
    const sent = await t.send([{ productId: t.mug.id, quantity: 1 }]);
    const other = await signUp(app);
    expect((await other.agent.get(`/api/transfers/${sent.body.id}`)).status).toBe(404);
    expect((await other.agent.post(`/api/transfers/${sent.body.id}/receive`).send({})).status).toBe(404);
    expect((await other.agent.post(`/api/transfers/${sent.body.id}/cancel`)).status).toBe(404);
    const theirs = await other.agent
      .post('/api/transfers')
      .send({ fromStoreId: t.mainStore.id, toStoreId: other.mainStore.id, lines: [{ productId: t.mug.id, quantity: 1 }] });
    expect(theirs.status).toBe(400);
  });
});
