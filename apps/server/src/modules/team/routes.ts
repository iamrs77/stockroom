import { acceptInviteSchema } from '@stockroom/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '@/app';
import { getAuth, requireRole } from '@/http/auth';
import { rateLimiter } from '@/http/rate-limit';
import { parse, parseId } from '@/http/validate';
import { createSession, setSessionCookie, toSessionUser } from '@/modules/auth/sessions';
import { acceptInvite, createInvite, getTeam, previewInvite, removeMember, revokeInvite } from './service';

const inviteCreateSchema = z.object({ role: z.enum(['owner', 'staff']).default('staff') });

/** Managing the team. Owners only. */
export function teamRouter({ db }: AppDeps) {
  const router = Router();
  router.use(requireRole('owner'));

  router.get('/', async (req, res) => {
    res.json(await getTeam(db, getAuth(req)));
  });

  router.post('/invites', async (req, res) => {
    const { role } = parse(inviteCreateSchema, req.body ?? {});
    res.status(201).json(await createInvite(db, getAuth(req), role));
  });

  router.delete('/invites/:id', async (req, res) => {
    await revokeInvite(db, getAuth(req).tenant.id, parseId(req.params.id, 'Invite'));
    res.status(204).end();
  });

  router.delete('/members/:id', async (req, res) => {
    await removeMember(db, getAuth(req), parseId(req.params.id, 'Team member'));
    res.status(204).end();
  });

  return router;
}

/** Opening and accepting invite links. Public: the person accepting doesn't have an account yet. */
export function invitesPublicRouter({ db, config }: AppDeps) {
  const router = Router();
  // Invite tokens can't be guessed, but this stops anyone trying.
  const limiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    message: 'Too many attempts. Try again in a few minutes.',
  });

  router.get('/:token', limiter, async (req, res) => {
    res.json(await previewInvite(db, String(req.params.token)));
  });

  router.post('/:token/accept', limiter, async (req, res) => {
    const user = await acceptInvite(db, String(req.params.token), parse(acceptInviteSchema, req.body));
    const session = await createSession(db, user.id, config.sessionTtlMs);
    setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
    res.status(201).json({ user: toSessionUser(user) });
  });

  return router;
}
