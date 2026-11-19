import type { loginSchema, registerSchema } from '@stockroom/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, PG_UNIQUE_VIOLATION, type Db } from '@/db/client';
import { stores, tenants, users } from '@/db/schema';
import { HttpError } from '@/http/errors';
import { getDummyHash, hashPassword, verifyPassword } from './passwords';

/** Creates a business, its owner and a first store, together. */
export async function registerBusiness(db: Db, input: z.output<typeof registerSchema>) {
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: input.businessName }).returning();
    if (!tenant) throw new Error('Tenant insert returned nothing');
    try {
      const [created] = await tx
        .insert(users)
        .values({ tenantId: tenant.id, email: input.email, name: input.name, passwordHash, role: 'owner' })
        .returning();
      if (!created) throw new Error('User insert returned nothing');
      // Every business starts with one store so stock can be recorded straight away.
      await tx.insert(stores).values({ tenantId: tenant.id, name: 'Main store', code: 'MAIN' });
      return { ...created, tenant: { id: tenant.id, name: tenant.name } };
    } catch (err) {
      if (pgError(err)?.code === PG_UNIQUE_VIOLATION) {
        throw new HttpError(409, 'email_taken', 'An account with this email already exists');
      }
      throw err;
    }
  });
}

/** The user with this email and password, or a 401 that doesn't say which part was wrong. */
export async function checkCredentials(db: Db, input: z.output<typeof loginSchema>) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      passwordHash: users.passwordHash,
      tenant: { id: tenants.id, name: tenants.name, demoExpiresAt: tenants.demoExpiresAt },
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    // Someone removed from the team gets the same answer as a wrong password.
    .where(and(eq(users.email, input.email), isNull(users.deactivatedAt)));

  // Same work and same error whether or not the email exists.
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) {
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  return user;
}
