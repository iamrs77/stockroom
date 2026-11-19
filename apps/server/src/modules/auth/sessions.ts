import { createHash, randomBytes } from 'node:crypto';
import type { Role, SessionUser } from '@stockroom/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { CookieOptions, Response } from 'express';
import type { Db } from '../../db/client';
import { sessions, tenants, users } from '../../db/schema';

export const SESSION_COOKIE = 'sid';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: string, ttlMs: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export type AuthContext = SessionUser & { sessionId: string; sessionExpiresAt: Date };

export async function findSession(db: Db, token: string): Promise<AuthContext | undefined> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      sessionExpiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      tenantId: tenants.id,
      tenantName: tenants.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return undefined;
  const { tenantId, tenantName, ...rest } = row;
  return { ...rest, role: rest.role as Role, tenant: { id: tenantId, name: tenantName } };
}

/** Pushes the expiry forward for active users, at most once per day per session. */
export async function extendSessionIfStale(db: Db, auth: AuthContext, ttlMs: number) {
  const remaining = auth.sessionExpiresAt.getTime() - Date.now();
  if (ttlMs - remaining < 24 * 60 * 60 * 1000) return undefined;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, auth.sessionId));
  return expiresAt;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export function cookieOptions(secure: boolean, expires?: Date): CookieOptions {
  // SameSite=Lax means the browser doesn't send the cookie on cross-site POSTs, which blocks CSRF.
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', expires };
}

export function setSessionCookie(res: Response, token: string, expires: Date, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, cookieOptions(secure, expires));
}

export function toSessionUser(auth: SessionUser): SessionUser {
  return { id: auth.id, email: auth.email, name: auth.name, role: auth.role, tenant: auth.tenant };
}
