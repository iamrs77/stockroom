import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProduct, setupTestApp, signUp } from './helpers';

const { app } = setupTestApp();

async function setup() {
  const owner = await signUp(app);
  const product = await createProduct(owner.agent);
  const adjust = (delta: number, reason = delta > 0 ? 'received' : 'sold', idempotencyKey?: string) => {
    const req = owner.agent.post(`/api/products/${product.id}/stock-adjustments`);
    if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
    return req.send({ storeId: owner.mainStore.id, delta, reason });
  };
  return { ...owner, product, adjust };
}

describe('stock ledger', () => {
  it('records each change as a movement with the balance after it', async () => {
    const { agent, product, adjust } = await setup();

    const received = await adjust(10);
    expect(received.status).toBe(201);
    expect(received.body).toMatchObject({ quantity: 10, movement: { delta: 10, balanceAfter: 10, reason: 'received', userName: 'Owner' } });

    const sold = await adjust(-3);
    expect(sold.body).toMatchObject({ quantity: 7, movement: { delta: -3, balanceAfter: 7, reason: 'sold' } });

    const detail = await agent.get(`/api/products/${product.id}`);
    expect(detail.body.totalStock).toBe(7);

    const history = await agent.get(`/api/products/${product.id}/movements`);
    expect(history.body.items.map((m: { delta: number }) => m.delta)).toEqual([-3, 10]);
  });

  it('refuses to take stock below zero and records nothing', async () => {
    const { agent, product, adjust } = await setup();
    await adjust(2);

    const res = await adjust(-5);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('insufficient_stock');

    const history = await agent.get(`/api/products/${product.id}/movements`);
    expect(history.body.items).toHaveLength(1);
    expect((await agent.get(`/api/products/${product.id}`)).body.totalStock).toBe(2);
  });

  it('applies concurrent changes one after another without losing any', async () => {
    const { agent, product, adjust } = await setup();

    const results = await Promise.all(Array.from({ length: 25 }, () => adjust(1)));
    expect(results.every((r) => r.status === 201)).toBe(true);

    expect((await agent.get(`/api/products/${product.id}`)).body.totalStock).toBe(25);
    // Every movement saw a different running balance: 1, 2, ... 25.
    const balances = results.map((r) => r.body.movement.balanceAfter as number).sort((a, b) => a - b);
    expect(balances).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('never oversells when concurrent sales race for the last units', async () => {
    const { agent, product, adjust } = await setup();
    await adjust(5);

    const results = await Promise.all(Array.from({ length: 12 }, () => adjust(-1)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect((await agent.get(`/api/products/${product.id}`)).body.totalStock).toBe(0);
  });

  it('pages through history with a cursor', async () => {
    const { agent, product, adjust } = await setup();
    for (let i = 1; i <= 5; i++) await adjust(i);

    const first = await agent.get(`/api/products/${product.id}/movements`).query({ limit: 2 });
    expect(first.body.items.map((m: { delta: number }) => m.delta)).toEqual([5, 4]);
    const second = await agent
      .get(`/api/products/${product.id}/movements`)
      .query({ limit: 2, before: first.body.nextCursor });
    expect(second.body.items.map((m: { delta: number }) => m.delta)).toEqual([3, 2]);
    const last = await agent.get(`/api/products/${product.id}/movements`).query({ limit: 2, before: second.body.nextCursor });
    expect(last.body).toMatchObject({ nextCursor: null });
    expect(last.body.items.map((m: { delta: number }) => m.delta)).toEqual([1]);
  });

  it('rejects a store from another business', async () => {
    const { product, agent } = await setup();
    const other = await signUp(app);
    const res = await agent
      .post(`/api/products/${product.id}/stock-adjustments`)
      .send({ storeId: other.mainStore.id, delta: 1, reason: 'received' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'storeId', message: 'Unknown store' }]);
  });
});

describe('idempotency keys', () => {
  it('replays the stored response for a retry instead of applying the change twice', async () => {
    const { agent, product, adjust } = await setup();
    const key = randomUUID();

    const first = await adjust(4, 'received', key);
    const retry = await adjust(4, 'received', key);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect((await agent.get(`/api/products/${product.id}`)).body.totalStock).toBe(4);
  });

  it('applies the change once when the same request is sent several times at once', async () => {
    const { agent, product, adjust } = await setup();
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 5 }, () => adjust(3, 'received', key)));
    // One request does the work. The others get its stored response, or 409 if it hadn't finished yet.
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect((await agent.get(`/api/products/${product.id}`)).body.totalStock).toBe(3);
  });

  it('replays a stored client error too, so the outcome for a key never changes', async () => {
    const { adjust } = await setup();
    const key = randomUUID();
    expect((await adjust(-1, 'sold', key)).status).toBe(409);
    await adjust(10); // stock arrives, but the retry still gets the original answer
    const retry = await adjust(-1, 'sold', key);
    expect(retry.status).toBe(409);
    expect(retry.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects a key reused with a different body', async () => {
    const { adjust } = await setup();
    const key = randomUUID();
    await adjust(1, 'received', key);
    const res = await adjust(2, 'received', key);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('idempotency_key_reused');
  });

  it('scopes keys to a business', async () => {
    const a = await setup();
    const b = await setup();
    const key = randomUUID();
    expect((await a.adjust(1, 'received', key)).status).toBe(201);
    expect((await b.adjust(1, 'received', key)).headers['idempotent-replayed']).toBeUndefined();
  });
});
