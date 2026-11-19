import type { Tx } from './client';
import { syncLowStockAlerts } from '../modules/events/outbox';
import { products, stockLevels, stockMovements, stores } from './schema';

/** A small café-and-gift-shop catalogue: 136 products in five categories. */
const catalogue: Record<string, { code: string; items: string[]; variants: string[]; price: [number, number] }> = {
  'Coffee & Tea': {
    code: 'BEV',
    items: ['Dark Roast Beans', 'Medium Roast Beans', 'Espresso Blend', 'Decaf Beans', 'Green Tea', 'Earl Grey', 'Chai Masala', 'Cold Brew Pack'],
    variants: ['250 g', '500 g', '1 kg'],
    price: [900, 3800],
  },
  Kitchen: {
    code: 'KIT',
    items: ['Pour-Over Kettle', 'French Press', 'Ceramic Mug', 'Travel Tumbler', 'Glass Carafe', 'Burr Grinder', 'Milk Frother', 'Tea Infuser'],
    variants: ['Black', 'White', 'Sage', 'Clay'],
    price: [1200, 14900],
  },
  Bakery: {
    code: 'BAK',
    items: ['Sourdough Loaf', 'Butter Croissant', 'Blueberry Muffin', 'Cinnamon Bun', 'Banana Bread', 'Oat Cookie', 'Bagel', 'Scone'],
    variants: ['Single', '4-pack', '12-pack'],
    price: [300, 2400],
  },
  Pantry: {
    code: 'PAN',
    items: ['Maple Syrup', 'Wildflower Honey', 'Oat Milk', 'Almond Butter', 'Granola', 'Dark Chocolate', 'Sea Salt Caramels', 'Raw Sugar'],
    variants: ['Small', 'Medium', 'Large'],
    price: [500, 2900],
  },
  Merch: {
    code: 'MER',
    items: ['Canvas Tote', 'Logo Hoodie', 'Enamel Pin', 'Sticker Pack', 'Beanie', 'Notebook', 'Postcard Set', 'Cap'],
    variants: ['S', 'M', 'L', 'XL'],
    price: [400, 6500],
  },
};

export const SAMPLE_STORES = [
  { name: 'Queen Street West', code: 'QSW' },
  { name: 'Kensington Market', code: 'KEN' },
  { name: 'Warehouse', code: 'WH' },
];

/** Small deterministic random generator, so the same seed always produces the same business. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fills an empty business with three stores, 136 products and opening stock. Most products are
 * well stocked, some are low or sold out, so every screen has something to show. Low-stock alerts
 * open the same way they would after any stock change. Runs inside the caller's transaction.
 */
export async function seedSampleBusiness(tx: Tx, { tenantId, ownerId, seed = 42 }: { tenantId: string; ownerId: string; seed?: number }) {
  const random = mulberry32(seed);
  const between = (min: number, max: number) => Math.floor(min + random() * (max - min + 1));

  const createdStores = await tx
    .insert(stores)
    .values(SAMPLE_STORES.map((s) => ({ ...s, tenantId })))
    .returning();

  type Profile = 'healthy' | 'low' | 'out';
  const profiles = new Map<string, Profile>();
  const productRows = Object.entries(catalogue).flatMap(([category, { code, items, variants, price }]) =>
    items.flatMap((item, i) =>
      variants.map((variant, v) => {
        const sku = `${code}-${String(i + 1).padStart(2, '0')}${String(v + 1).padStart(2, '0')}`;
        const roll = random();
        const profile: Profile = roll < 0.06 ? 'out' : roll < 0.18 ? 'low' : 'healthy';
        profiles.set(sku, profile);
        return {
          tenantId,
          sku,
          name: `${item}, ${variant}`,
          category,
          priceCents: Math.round(between(price[0], price[1]) / 50) * 50 - 1,
          reorderPoint: profile === 'low' ? between(10, 20) : between(0, 4) === 0 ? 0 : between(5, 20),
        };
      }),
    ),
  );
  const createdProducts = await tx.insert(products).values(productRows).returning({ id: products.id, sku: products.sku });

  const levels: (typeof stockLevels.$inferInsert)[] = [];
  const movements: (typeof stockMovements.$inferInsert)[] = [];
  for (const product of createdProducts) {
    const profile = profiles.get(product.sku);
    for (const store of createdStores) {
      const quantity =
        profile === 'out'
          ? 0
          : profile === 'low'
            ? between(0, 3) // at most 9 in total, below a reorder point of 10 or more
            : random() < 0.1
              ? 0
              : between(10, store.code === 'WH' ? 400 : 80);
      if (quantity === 0) continue;
      levels.push({ tenantId, productId: product.id, storeId: store.id, quantity });
      movements.push({
        tenantId,
        productId: product.id,
        storeId: store.id,
        delta: quantity,
        balanceAfter: quantity,
        reason: 'received',
        note: 'Opening stock',
        userId: ownerId,
      });
    }
  }
  // Batches stay well under Postgres's 65,535 bind-parameter limit.
  for (let i = 0; i < levels.length; i += 1000) await tx.insert(stockLevels).values(levels.slice(i, i + 1000));
  for (let i = 0; i < movements.length; i += 1000) await tx.insert(stockMovements).values(movements.slice(i, i + 1000));
  await syncLowStockAlerts(tx, tenantId, createdProducts.map((p) => p.id));

  return { stores: createdStores, products: createdProducts.length, stockLevels: levels.length };
}
