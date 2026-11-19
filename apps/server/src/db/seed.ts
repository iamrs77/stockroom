/**
 * Creates (or recreates) a demo business with three stores, about 200 products and opening stock.
 * Run with `npm run db:seed`. Safe to run again: it replaces only the demo business.
 */
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { hashPassword } from '../modules/auth/passwords';
import { createDb, waitForDatabase } from './client';
import { syncLowStockAlerts } from '../modules/events/outbox';
import { runMigrations } from './migrate';
import { products, stockLevels, stockMovements, stores, tenants, users } from './schema';

export const DEMO_EMAIL = 'demo@stockroom.app';
export const DEMO_PASSWORD = 'stockroom-demo';

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

const storeSeeds = [
  { name: 'Queen Street West', code: 'QSW' },
  { name: 'Kensington Market', code: 'KEN' },
  { name: 'Warehouse', code: 'WH' },
];

/** Small deterministic random generator, so every seed produces the same data. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl, 2);
await waitForDatabase(pool);
await runMigrations(db);

const random = mulberry32(42);
const between = (min: number, max: number) => Math.floor(min + random() * (max - min + 1));

await db.transaction(async (tx) => {
  const [existing] = await tx.select({ tenantId: users.tenantId }).from(users).where(eq(users.email, DEMO_EMAIL));
  if (existing) await tx.delete(tenants).where(eq(tenants.id, existing.tenantId));

  const [tenant] = await tx.insert(tenants).values({ name: 'Maple & Pine Supply Co.' }).returning();
  if (!tenant) throw new Error('Could not create the demo business');
  const [owner] = await tx
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: DEMO_EMAIL,
      name: 'Demo Owner',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: 'owner',
    })
    .returning();
  if (!owner) throw new Error('Could not create the demo user');

  const createdStores = await tx
    .insert(stores)
    .values(storeSeeds.map((s) => ({ ...s, tenantId: tenant.id })))
    .returning();

  // Most products are well stocked; some are low or sold out, so the low-stock view has something to show.
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
          tenantId: tenant.id,
          sku,
          name: `${item}, ${variant}`,
          category,
          priceCents: Math.round(between(price[0], price[1]) / 50) * 50 - 1,
          reorderPoint: profile === 'low' ? between(10, 20) : between(0, 4) === 0 ? 0 : between(5, 20),
        };
      }),
    ),
  );
  const createdProducts = await tx.insert(products).values(productRows).returning();

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
      levels.push({ tenantId: tenant.id, productId: product.id, storeId: store.id, quantity });
      movements.push({
        tenantId: tenant.id,
        productId: product.id,
        storeId: store.id,
        delta: quantity,
        balanceAfter: quantity,
        reason: 'received',
        note: 'Opening stock',
        userId: owner.id,
      });
    }
  }
  // Insert in batches to stay well under Postgres's 65,535 bind-parameter limit.
  for (let i = 0; i < levels.length; i += 1000) await tx.insert(stockLevels).values(levels.slice(i, i + 1000));
  for (let i = 0; i < movements.length; i += 1000) await tx.insert(stockMovements).values(movements.slice(i, i + 1000));
  // Open alerts for products that start out low, the same way any stock change would.
  await syncLowStockAlerts(tx, tenant.id, createdProducts.map((p) => p.id));

  console.log(
    `Seeded "${tenant.name}": ${createdStores.length} stores, ${createdProducts.length} products, ${levels.length} stock levels`,
  );
});

await pool.end();
console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
