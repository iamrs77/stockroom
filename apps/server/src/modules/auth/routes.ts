import { loginSchema, registerSchema } from '@stockroom/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppDeps } from '../../app';
import { pgError, PG_UNIQUE_VIOLATION } from '../../db/client';
import { stores, tenants, users } from '../../db/schema';
import { HttpError } from '../../http/errors';
import { parse } from '../../http/validate';
import { getDummyHash, hashPassword, verifyPassword } from './passwords';
import {
  cookieOptions,
  createSession,
  deleteSession,
  findSession,
  SESSION_COOKIE,
  setSessionCookie,
  toSessionUser,
} from './sessions';

export function authRouter(deps: AppDeps) {
  const { db, config } = deps;
  const router = Router();

  // Slows down password guessing. The in-memory store is per process; see docs/adr/0004.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: () => {
      throw new HttpError(429, 'too_many_requests', 'Too many attempts. Try again in a few minutes.');
    },
  });

  router.post('/register', limiter, async (req, res) => {
    if (!config.signupsEnabled) {
      throw new HttpError(403, 'signups_disabled', 'New accounts are turned off here. Try the demo instead.');
    }
    const input = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(input.password);

    const user = await db.transaction(async (tx) => {
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

    const session = await createSession(db, user.id, config.sessionTtlMs);
    setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
    res.status(201).json({ user: toSessionUser(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
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

    const session = await createSession(db, user.id, config.sessionTtlMs);
    setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
    res.json({ user: toSessionUser(user) });
  });

  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) await deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE, cookieOptions(config.cookieSecure));
    res.status(204).end();
  });

  // "Who is signed in?" is a normal question for the web app to ask, so no session is a 200 with
  // user: null rather than a 401 (which browsers log as an error on every visit to the sign-in page).
  router.get('/me', async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const auth = typeof token === 'string' && token ? await findSession(db, token) : undefined;
    res.json({ user: auth ? toSessionUser(auth) : null });
  });

  return router;
}
