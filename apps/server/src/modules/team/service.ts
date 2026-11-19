import { createHash, randomBytes } from 'node:crypto';
import type { acceptInviteSchema, InvitePreview, PendingInvite, Role, SessionUser, Team } from '@stockroom/shared';
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, PG_UNIQUE_VIOLATION, type Db } from '@/db/client';
import { invites, sessions, tenants, users } from '@/db/schema';
import { HttpError, notFound } from '@/http/errors';
import { hashPassword } from '@/modules/auth/passwords';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const toInvite = (row: { id: string; role: Role; createdBy: string | null; createdAt: Date; expiresAt: Date }): PendingInvite => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

/** Everyone active in the business, and the invite links that can still be used. */
export async function getTeam(db: Db, you: SessionUser): Promise<Team> {
  const members = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.tenantId, you.tenant.id), isNull(users.deactivatedAt)))
    .orderBy(asc(users.createdAt));
  const creator = users;
  const pending = await db
    .select({ id: invites.id, role: invites.role, createdBy: creator.name, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
    .from(invites)
    .leftJoin(creator, eq(creator.id, invites.createdBy))
    .where(and(eq(invites.tenantId, you.tenant.id), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
    .orderBy(asc(invites.createdAt));
  return {
    members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), isYou: m.id === you.id })),
    invites: pending.map(toInvite),
  };
}

/** Creates an invite link. The token is returned once; only its hash is stored. */
export async function createInvite(db: Db, createdBy: SessionUser, role: Role) {
  const token = randomBytes(32).toString('base64url');
  const [invite] = await db
    .insert(invites)
    .values({ tenantId: createdBy.tenant.id, tokenHash: hashToken(token), role, createdBy: createdBy.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .returning({ id: invites.id, role: invites.role, createdAt: invites.createdAt, expiresAt: invites.expiresAt });
  return { invite: toInvite({ ...invite!, createdBy: createdBy.name }), token };
}

/** Cancels an invite that hasn't been accepted yet. */
export async function revokeInvite(db: Db, tenantId: string, id: string) {
  const [revoked] = await db
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(invites.id, id), eq(invites.tenantId, tenantId), isNull(invites.acceptedAt)))
    .returning({ id: invites.id });
  if (!revoked) throw notFound('Invite');
}

/**
 * Removes someone from the team. They're deactivated rather than deleted, so their name stays
 * on the stock history they made, and their sessions are deleted, so access ends immediately.
 */
export async function removeMember(db: Db, you: SessionUser, id: string) {
  if (id === you.id) throw new HttpError(409, 'cannot_remove_self', "You can't remove yourself");
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .update(users)
      .set({ deactivatedAt: sql`now()` })
      .where(and(eq(users.id, id), eq(users.tenantId, you.tenant.id), isNull(users.deactivatedAt), ne(users.id, you.id)))
      .returning({ id: users.id });
    if (!removed) throw notFound('Team member');
    await tx.delete(sessions).where(eq(sessions.userId, id));
  });
}

const usable = (token: string) =>
  and(eq(invites.tokenHash, hashToken(token)), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date()));
const unavailable = () => new HttpError(410, 'invite_unavailable', 'This invite link has expired, been used, or been cancelled. Ask for a new one.');

/** What an invite link is for, shown before the person accepts it. */
export async function previewInvite(db: Db, token: string): Promise<InvitePreview> {
  const [invite] = await db
    .select({ businessName: tenants.name, role: invites.role, expiresAt: invites.expiresAt })
    .from(invites)
    .innerJoin(tenants, eq(tenants.id, invites.tenantId))
    .where(usable(token));
  if (!invite) throw unavailable();
  return { ...invite, expiresAt: invite.expiresAt.toISOString() };
}

/** Uses an invite link to create the person's account, in the business and with the role on the invite. */
export async function acceptInvite(db: Db, token: string, input: z.output<typeof acceptInviteSchema>) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    // Claiming the invite and creating the account commit together. Of two people using the same
    // link at once, the second finds it already accepted, so a link makes exactly one account.
    const [invite] = await tx
      .update(invites)
      .set({ acceptedAt: sql`now()` })
      .where(usable(token))
      .returning();
    if (!invite) throw unavailable();
    try {
      const [created] = await tx
        .insert(users)
        .values({ tenantId: invite.tenantId, email: input.email, name: input.name, passwordHash, role: invite.role })
        .returning();
      await tx.update(invites).set({ acceptedBy: created!.id }).where(eq(invites.id, invite.id));
      const [tenant] = await tx
        .select({ id: tenants.id, name: tenants.name, demoExpiresAt: tenants.demoExpiresAt })
        .from(tenants)
        .where(eq(tenants.id, invite.tenantId));
      return { ...created!, tenant: tenant! };
    } catch (err) {
      if (pgError(err)?.code === PG_UNIQUE_VIOLATION) throw new HttpError(409, 'email_taken', 'An account with this email already exists');
      throw err;
    }
  });
}
