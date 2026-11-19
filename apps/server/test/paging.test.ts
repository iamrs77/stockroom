import type { ProductPage } from '@stockroom/shared';
import { describe, expect, it } from 'vitest';
import { processImport } from '../src/modules/imports/process';
import { createImport } from '../src/modules/imports/service';
import { createProduct, setupTestApp, signUp, silentLogger } from './helpers';

const { app, db } = setupTestApp();

/**
 * 23 products with plenty of ties: 7 share a name, stock repeats, and they're created in a burst
 * so several share an updated_at down to the millisecond. Ties are where keyset paging goes wrong.
 */
async function setup() {
  const owner = await signUp(app);
  const ids: string[] = [];
  for (let i = 0; i < 23; i++) {
    const name = i < 7 ? 'Same Name' : `Product ${String.fromCharCode(65 + (i % 9))}`;
    const product = await createProduct(owner.agent, { sku: `P-${String(i).padStart(2, '0')}`, name });
    ids.push(product.id);
    const qty = (i % 4) * 5;
    if (qty) {
      await owner.agent
        .post(`/api/products/${product.id}/stock-adjustments`)
        .send({ storeId: owner.mainStore.id, delta: qty, reason: 'received' });
    }
  }
  const list = (query: Record<string, string | number>) => owner.agent.get('/api/products').query(query);
  return { ...owner, ids, list };
}

async function walk(list: (q: Record<string, string | number>) => Promise<{ body: ProductPage }>, base: Record<string, string>) {
  // Forwards from the first page.
  const forward: string[] = [];
  let res = await list({ ...base, pageSize: 5 });
  forward.push(...res.body.items.map((p) => p.id));
  while (res.body.nextCursor) {
    res = await list({ ...base, pageSize: 5, after: res.body.nextCursor });
    forward.push(...res.body.items.map((p) => p.id));
  }
  // Then backwards from the last page.
  const backward: string[][] = [res.body.items.map((p) => p.id)];
  while (res.body.prevCursor) {
    res = await list({ ...base, pageSize: 5, before: res.body.prevCursor });
    backward.unshift(res.body.items.map((p) => p.id));
  }
  return { forward, backward: backward.flat() };
}

describe('keyset paging', () => {
  it.each([
    ['name', 'asc'],
    ['stock', 'desc'],
    ['updated', 'desc'],
  ])('visits every product once, in order, sorted by %s %s', async (sort, dir) => {
    const t = await setup();
    const all = (await t.list({ sort, dir, pageSize: 100 })).body.items.map((p: { id: string }) => p.id);
    expect(all).toHaveLength(23);

    const { forward, backward } = await walk(t.list, { sort, dir });
    expect(forward).toEqual(all);
    expect(backward).toEqual(all);
  });

  it('marks cursor pages as unnumbered, and the first page as having no previous', async () => {
    const t = await setup();
    const first = (await t.list({ pageSize: 10 })).body as ProductPage;
    expect(first).toMatchObject({ page: 1, prevCursor: null, total: 23 });
    const second = (await t.list({ pageSize: 10, after: first.nextCursor! })).body as ProductPage;
    expect(second.page).toBeNull();
    expect(second.prevCursor).not.toBeNull();
  });

  it('stops counting at 10,000 and says so, but keeps paging past it', async () => {
    const owner = await signUp(app);
    const rows = Array.from({ length: 10_050 }, (_, i) => `BULK-${String(i).padStart(5, '0')},Bulk ${i},1`);
    const { summary } = await createImport(db, {
      tenantId: owner.user.tenant.id,
      userId: owner.user.id,
      fileName: 'bulk.csv',
      content: Buffer.from(['sku,name,price', ...rows].join('\n')),
      format: 'csv',
    });
    await processImport(db, summary.id, { chunkSize: 5000, logger: silentLogger });

    const first = (await owner.agent.get('/api/products').query({ sort: 'sku', pageSize: 100 })).body as ProductPage;
    expect(first).toMatchObject({ total: 10_000, totalCapped: true });
    // Searching narrows it again, and the count is exact.
    const some = (await owner.agent.get('/api/products').query({ q: 'bulk-0999' })).body as ProductPage;
    expect(some).toMatchObject({ total: 10, totalCapped: false }); // BULK-09990 to BULK-09999

    // A cursor taken from deep in the list (by number, via OFFSET) still leads to the right next page.
    const deep = (await owner.agent.get('/api/products').query({ sort: 'sku', pageSize: 100, page: 100 })).body as ProductPage;
    expect(deep.items[0]!.sku).toBe('BULK-09900');
    const next = (await owner.agent.get('/api/products').query({ sort: 'sku', pageSize: 100, after: deep.nextCursor! })).body as ProductPage;
    expect(next.items.map((p) => p.sku)).toEqual(Array.from({ length: 50 }, (_, i) => `BULK-${10_000 + i}`));
    expect(next.nextCursor).toBeNull();
  }, 60_000);

  it('rejects a cursor that has been tampered with', async () => {
    const t = await setup();
    const res = await t.list({ after: 'not-a-cursor' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_cursor');
  });

  it('searches case-insensitively across name, SKU and category', async () => {
    const t = await setup();
    expect((await t.list({ q: 'SAME NAME' })).body.total).toBe(7);
    expect((await t.list({ q: 'p-0' })).body.total).toBe(10);
  });
});
