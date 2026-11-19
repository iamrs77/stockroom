import { describe, expect, it } from 'vitest';
import { createProduct, setupTestApp, signUp } from './helpers';

const { app } = setupTestApp();

describe('tenant isolation', () => {
  it("never shows or changes another business's data", async () => {
    const alice = await signUp(app, 'Alice Supplies');
    const bob = await signUp(app, 'Bob Goods');
    const aliceProduct = await createProduct(alice.agent, { sku: 'SHARED-SKU', name: "Alice's product" });

    // Bob can use the same SKU: SKUs are unique per business, not globally.
    await createProduct(bob.agent, { sku: 'SHARED-SKU', name: "Bob's product" });

    const bobList = await bob.agent.get('/api/products');
    expect(bobList.body.items.map((p: { name: string }) => p.name)).toEqual(["Bob's product"]);

    // Every way of reaching Alice's product by id looks like it doesn't exist.
    const id = aliceProduct.id;
    expect((await bob.agent.get(`/api/products/${id}`)).status).toBe(404);
    expect((await bob.agent.patch(`/api/products/${id}`).send({ name: 'Hacked' })).status).toBe(404);
    expect((await bob.agent.delete(`/api/products/${id}`)).status).toBe(404);
    expect((await bob.agent.get(`/api/products/${id}/movements`)).status).toBe(404);
    expect(
      (
        await bob.agent
          .post(`/api/products/${id}/stock-adjustments`)
          .send({ storeId: bob.mainStore.id, delta: 1, reason: 'received' })
      ).status,
    ).toBe(404);

    const stillThere = await alice.agent.get(`/api/products/${id}`);
    expect(stillThere.body).toMatchObject({ name: "Alice's product", totalStock: 0 });

    const bobStores = await bob.agent.get('/api/stores');
    expect(bobStores.body.items.map((s: { id: string }) => s.id)).toEqual([bob.mainStore.id]);
  });
});
