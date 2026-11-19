import { describe, expect, it } from 'vitest';
import { createProduct, setupTestApp, signUp } from './helpers';

const { app } = setupTestApp();

describe('products', () => {
  it('creates, reads, updates and archives a product', async () => {
    const { agent } = await signUp(app);
    const created = await createProduct(agent, { sku: 'MUG-01', name: 'Ceramic Mug', category: 'Kitchen' });

    const detail = await agent.get(`/api/products/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ sku: 'MUG-01', category: 'Kitchen', totalStock: 0, reorderPoint: 0 });
    expect(detail.body.stock).toEqual([expect.objectContaining({ storeCode: 'MAIN', quantity: 0 })]);

    const updated = await agent.patch(`/api/products/${created.id}`).send({ priceCents: 2200, category: '' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ priceCents: 2200, category: null, name: 'Ceramic Mug' });

    expect((await agent.delete(`/api/products/${created.id}`)).status).toBe(204);
    expect((await agent.get(`/api/products/${created.id}`)).status).toBe(404);
  });

  it('keeps SKUs unique among active products, and frees a SKU on archive', async () => {
    const { agent } = await signUp(app);
    const first = await createProduct(agent, { sku: 'TOTE-1' });

    const duplicate = await agent.post('/api/products').send({ sku: 'TOTE-1', name: 'Tote', priceCents: 100 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('sku_taken');

    await agent.delete(`/api/products/${first.id}`);
    await createProduct(agent, { sku: 'TOTE-1' });
  });

  it('searches, sorts and paginates', async () => {
    const { agent } = await signUp(app);
    for (const [sku, name, priceCents] of [
      ['TEA-1', 'Earl Grey', 900],
      ['TEA-2', 'Green Tea', 700],
      ['COF-1', 'Dark Roast', 1500],
      ['COF-2', 'Espresso Blend', 1700],
      ['MUG-1', 'Tea Mug', 1200],
    ] as const) {
      await createProduct(agent, { sku, name, priceCents });
    }

    const search = await agent.get('/api/products').query({ q: 'tea', sort: 'price', dir: 'asc' });
    // Earl Grey matches on its SKU (TEA-1); the other two match on name.
    expect(search.body.total).toBe(3);
    expect(search.body.items.map((p: { name: string }) => p.name)).toEqual(['Green Tea', 'Earl Grey', 'Tea Mug']);

    const page2 = await agent.get('/api/products').query({ sort: 'sku', pageSize: 2, page: 2 });
    expect(page2.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(page2.body.items.map((p: { sku: string }) => p.sku)).toEqual(['MUG-1', 'TEA-1']);
  });

  it('treats LIKE wildcards in a search as plain text', async () => {
    const { agent } = await signUp(app);
    await createProduct(agent, { name: '100% Cotton Tote' });
    await createProduct(agent, { name: 'Linen Tote' });
    const res = await agent.get('/api/products').query({ q: '100%' });
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['100% Cotton Tote']);
  });

  it('filters to products at or below their reorder point', async () => {
    const { agent, mainStore } = await signUp(app);
    const low = await createProduct(agent, { name: 'Low', reorderPoint: 5 });
    const fine = await createProduct(agent, { name: 'Fine', reorderPoint: 5 });
    await createProduct(agent, { name: 'No reorder point' });
    await agent.post(`/api/products/${low.id}/stock-adjustments`).send({ storeId: mainStore.id, delta: 3, reason: 'received' });
    await agent.post(`/api/products/${fine.id}/stock-adjustments`).send({ storeId: mainStore.id, delta: 9, reason: 'received' });

    const res = await agent.get('/api/products').query({ lowStock: 'true' });
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Low']);
  });

  it('returns 404 for a malformed id', async () => {
    const { agent } = await signUp(app);
    expect((await agent.get('/api/products/not-a-uuid')).status).toBe(404);
  });

  it('only lets owners add stores', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/api/stores').send({ name: 'Queen St West', code: 'qsw' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('QSW');
    const duplicate = await agent.post('/api/stores').send({ name: 'Another', code: 'QSW' });
    expect(duplicate.status).toBe(409);
  });
});
