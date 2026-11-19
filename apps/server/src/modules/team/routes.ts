import { createHash, randomBytes } from 'node:crypto';
import { acceptInviteSchema, type InvitePreview, type PendingInvite, type Role, type Team } from '@stockroom/shared';
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { pgError, PG_UNIQUE_VIOLATION } from '../../db/client';
import { invites, sessions, tenants, users } from '../../db/schema';
import { getAuth, requireRole } from '../../http/auth';
import { HttpError, notFound } from '../../http/errors';
import { parse, parseId } from '../../http/validate';
import { hashPassword } from '../auth/passwords';
import { createSession, setSessionCookie, toSessionUser } from '../auth/sessions';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const inviteCreateSchema = z.object({ role: z.enum(['owner', 'staff']).default('staff') });

const toInvite = (row: { id: string; role: Role; createdBy: string | null; createdAt: Date; expiresAt: Date }): PendingInvite => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

/** Managing the team. Owners only. */
export function teamRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  router.use(requireRole('owner'));

  router.get('/', async (req, res) => {
    const auth = getAuth(req);
    const members = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.tenantId, auth.tenant.id), isNull(users.deactivatedAt)))
      .orderBy(asc(users.createdAt));
    const creator = users;
    const pending = await db
      .select({ id: invites.id, role: invites.role, createdBy: creator.name, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
      .from(invites)
      .leftJoin(creator, eq(creator.id, invites.createdBy))
      .where(and(eq(invites.tenantId, auth.tenant.id), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
      .orderBy(asc(invites.createdAt));
    const team: Team = {
      members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), isYou: m.id === auth.id })),
      invites: pending.map(toInvite),
    };
    res.json(team);
  });

  /** Creates an invite link. The token is returned once; only its hash is stored. */
  router.post('/invites', async (req, res) => {
    const auth = getAuth(req);
    const { role } = parse(inviteCreateSchema, req.body ?? {});
    const token = randomBytes(32).toString('base64url');
    const [invite] = await db
      .insert(invites)
      .values({ tenantId: auth.tenant.id, tokenHash: hashToken(token), role, createdBy: auth.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
      .returning({ id: invites.id, role: invites.role, createdAt: invites.createdAt, expiresAt: invites.expiresAt });
    res.status(201).json({ invite: toInvite({ ...invite!, createdBy: auth.name }), token });
  });

  router.delete('/invites/:id', async (req, res) => {
    const auth = getAuth(req);
    const [revoked] = await db
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(invites.id, parseId(req.params.id, 'Invite')), eq(invites.tenantId, auth.tenant.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    if (!revoked) throw notFound('Invite');
    res.status(204).end();
  });

  /**
   * Removes someone from the team. They're deactivated rather than deleted, so their name stays
   * on the stock history they made, and their sessions are deleted, so access ends immediately.
   */
  router.delete('/members/:id', async (req, res) => {
    const auth = getAuth(req);
    const id = parseId(req.params.id, 'Team member');
    if (id === auth.id) throw new HttpError(409, 'cannot_remove_self', "You can't remove yourself");
    await db.transaction(async (tx) => {
      const [removed] = await tx
        .update(users)
        .set({ deactivatedAt: sql`now()` })
        .where(and(eq(users.id, id), eq(users.tenantId, auth.tenant.id), isNull(users.deactivatedAt), ne(users.id, auth.id)))
        .returning({ id: users.id });
      if (!removed) throw notFound('Team member');
      await tx.delete(sessions).where(eq(sessions.userId, id));
    });
    res.status(204).end();
  });

  return router;
}

/** Opening and accepting invite links. Public: the person accepting doesn't have an account yet. */
export function invitesPublicRouter(deps: AppDeps) {
  const { db, config } = deps;
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: () => {
      throw new HttpError(429, 'too_many_requests', 'Too many attempts. Try again in a few minutes.');
    },
  });
  const usable = (tokenHash: string) =>
    and(eq(invites.tokenHash, tokenHash), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date()));
  const unavailable = () => new HttpError(410, 'invite_unavailable', 'This invite link has expired, been used, or been cancelled. Ask for a new one.');

  router.get('/:token', limiter, async (req, res) => {
    const [invite] = await db
      .select({ businessName: tenants.name, role: invites.role, expiresAt: invites.expiresAt })
      .from(invites)
      .innerJoin(tenants, eq(tenants.id, invites.tenantId))
      .where(usable(hashToken(String(req.params.token))));
    if (!invite) throw unavailable();
    const preview: InvitePreview = { ...invite, expiresAt: invite.expiresAt.toISOString() };
    res.json(preview);
  });

  router.post('/:token/accept', limiter, async (req, res) => {
    const input = parse(acceptInviteSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      // Claiming the invite and creating the account commit together. Of two people using the same
      // link at once, the second finds it already accepted, so a link makes exactly one account.
      const [invite] = await tx
        .update(invites)
        .set({ acceptedAt: sql`now()` })
        .where(usable(hashToken(String(req.params.token))))
        .returning();
      if (!invite) throw unavailable();
      try {
        const [created] = await tx
          .insert(users)
          .values({ tenantId: invite.tenantId, email: input.email, name: input.name, passwordHash, role: invite.role })
          .returning();
        await tx.update(invites).set({ acceptedBy: created!.id }).where(eq(invites.id, invite.id));
        const [tenant] = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, invite.tenantId));
        return { ...created!, tenant: tenant! };
      } catch (err) {
        if (pgError(err)?.code === PG_UNIQUE_VIOLATION) throw new HttpError(409, 'email_taken', 'An account with this email already exists');
        throw err;
      }
    });
    const session = await createSession(db, user.id, config.sessionTtlMs);
    setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
    res.status(201).json({ user: toSessionUser(user) });
  });

  return router;
}
