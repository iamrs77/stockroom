import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { seedSampleBusiness } from '../../db/sample-business';
import { products, stockLevels, stores, tenants, users } from '../../db/schema';
import { HttpError } from '../../http/errors';
import type { Logger } from '../../logger';
import { createTransfer, receiveTransfer } from '../transfers/service';

/**
 * Creates a private demo business for one visitor: the sample catalogue, three stores, opening
 * stock, low-stock alerts, and a couple of transfers so every screen has something on it. It's
 * deleted automatically when it expires, so visitors can change anything without affecting anyone else.
 */
export async function createDemoBusiness(db: Db, config: Config, logger: Logger) {
  // A soft cap: two visitors at the same moment can both squeeze in, which is fine.
  const [{ active } = { active: 0 }] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(tenants)
    .where(gt(tenants.demoExpiresAt, new Date()));
  if (active >= config.demo.maxActive) {
    throw new HttpError(503, 'demo_busy', 'The demo is very popular right now. Please try again in a few minutes.');
  }

  const expiresAt = new Date(Date.now() + config.demo.ttlMs);
  const created = await db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: 'Maple & Pine Supply Co.', demoExpiresAt: expiresAt }).returning();
    const [owner] = await tx
      .insert(users)
      .values({
        tenantId: tenant!.id,
        // .invalid is a reserved top-level domain, so this can never be a real address.
        email: `demo-${randomUUID()}@demo.invalid`,
        name: 'Demo Owner',
        // Not a valid hash, so nobody can sign in to this account with a password: only the session works.
        passwordHash: '!',
        role: 'owner',
      })
      .returning();
    await seedSampleBusiness(tx, { tenantId: tenant!.id, ownerId: owner!.id });
    return { tenant: tenant!, owner: owner! };
  });

  // A received transfer and one on its way, made through the real service so the ledger and
  // events are exactly what a person would produce. Nice to have, so a failure doesn't stop the demo.
  try {
    await addSampleTransfers(db, created.tenant.id, created.owner.id);
  } catch (err) {
    logger.warn({ err }, 'Could not add sample transfers to a demo business');
  }

  return { ...created.owner, tenant: created.tenant, sessionTtlMs: expiresAt.getTime() - Date.now() };
}

async function addSampleTransfers(db: Db, tenantId: string, userId: string) {
  const byCode = Object.fromEntries(
    (await db.select({ id: stores.id, code: stores.code }).from(stores).where(eq(stores.tenantId, tenantId))).map((s) => [s.code, s.id]),
  );
  // Well-stocked warehouse products to send to the shops.
  const plenty = await db
    .select({ id: products.id })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .where(and(eq(stockLevels.tenantId, tenantId), eq(stockLevels.storeId, byCode.WH!), gt(stockLevels.quantity, 40)))
    .orderBy(asc(products.sku))
    .limit(5);
  if (plenty.length < 5) return;

  const received = await createTransfer(db, {
    tenantId,
    userId,
    fromStoreId: byCode.WH!,
    toStoreId: byCode.QSW!,
    note: 'Monday delivery',
    lines: plenty.slice(0, 3).map((p, i) => ({ productId: p.id, quantity: 6 + i * 2 })),
  });
  await receiveTransfer(db, { tenantId, userId, transferId: received });
  await createTransfer(db, {
    tenantId,
    userId,
    fromStoreId: byCode.WH!,
    toStoreId: byCode.KEN!,
    note: 'Weekend restock',
    lines: plenty.slice(3, 5).map((p) => ({ productId: p.id, quantity: 12 })),
  });
}

/**
 * Deletes demo businesses whose time is up, a few at a time so a backlog can't hog the database.
 * Everything they contain goes with them (cascading foreign keys).
 */
export async function deleteExpiredDemos(db: Db, limit = 20) {
  const expired = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(isNotNull(tenants.demoExpiresAt), lt(tenants.demoExpiresAt, new Date())))
    .orderBy(asc(tenants.demoExpiresAt))
    .limit(limit);
  if (expired.length === 0) return 0;
  await db.delete(tenants).where(inArray(tenants.id, expired.map((t) => t.id)));
  return expired.length;
}
