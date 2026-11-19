/**
 * Creates (or recreates) a local demo business with a fixed login, for development.
 * Run with `npm run db:seed`. Safe to run again: it replaces only that business.
 * The live demo doesn't use this: each visitor gets their own sandbox (see modules/demo).
 */
import { eq } from 'drizzle-orm';
import { loadConfig } from '@/config';
import { hashPassword } from '@/modules/auth/passwords';
import { createDb, waitForDatabase } from './client';
import { runMigrations } from './migrate';
import { seedSampleBusiness } from './sample-business';
import { tenants, users } from './schema';

export const DEMO_EMAIL = 'demo@stockroom.app';
export const DEMO_PASSWORD = 'stockroom-demo';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl, 2);
await waitForDatabase(pool);
await runMigrations(db);

await db.transaction(async (tx) => {
  const [existing] = await tx.select({ tenantId: users.tenantId }).from(users).where(eq(users.email, DEMO_EMAIL));
  if (existing) await tx.delete(tenants).where(eq(tenants.id, existing.tenantId));

  const [tenant] = await tx.insert(tenants).values({ name: 'Maple & Pine Supply Co.' }).returning();
  if (!tenant) throw new Error('Could not create the demo business');
  const [owner] = await tx
    .insert(users)
    .values({ tenantId: tenant.id, email: DEMO_EMAIL, name: 'Demo Owner', passwordHash: await hashPassword(DEMO_PASSWORD), role: 'owner' })
    .returning();
  if (!owner) throw new Error('Could not create the demo user');

  const seeded = await seedSampleBusiness(tx, { tenantId: tenant.id, ownerId: owner.id });
  console.log(`Seeded "${tenant.name}": ${seeded.stores.length} stores, ${seeded.products} products, ${seeded.stockLevels} stock levels`);
});

await pool.end();
console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
