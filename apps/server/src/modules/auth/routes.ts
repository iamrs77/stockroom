import { loginSchema, registerSchema } from '@stockroom/shared';
import { Router } from 'express';
import type { AppDeps } from '@/app';
import { HttpError } from '@/http/errors';
import { rateLimiter } from '@/http/rate-limit';
import { parse } from '@/http/validate';
import { checkCredentials, registerBusiness } from './service';
import {
  cookieOptions,
  createSession,
  deleteSession,
  findSession,
  SESSION_COOKIE,
  setSessionCookie,
  toSessionUser,
} from './sessions';

/** Signing up, in and out, and "who is signed in?". Public: these run before the sign-in check. */
export function authRouter(deps: AppDeps) {
  const { db, config } = deps;
  const router = Router();

  // Slows down password guessing.
  const limiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    message: 'Too many attempts. Try again in a few minutes.',
  });

  router.post('/register', limiter, async (req, res) => {
    if (!config.signupsEnabled) {
      throw new HttpError(403, 'signups_disabled', 'New accounts are turned off here. Try the demo instead.');
    }
    const user = await registerBusiness(db, parse(registerSchema, req.body));
    const session = await createSession(db, user.id, config.sessionTtlMs);
    setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
    res.status(201).json({ user: toSessionUser(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const user = await checkCredentials(db, parse(loginSchema, req.body));
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
