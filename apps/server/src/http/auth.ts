import type { Role } from '@stockroom/shared';
import type { Request, RequestHandler } from 'express';
import type { AppDeps } from '../app';
import {
  extendSessionIfStale,
  findSession,
  SESSION_COOKIE,
  setSessionCookie,
  type AuthContext,
} from '../modules/auth/sessions';
import { HttpError } from './errors';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const unauthenticated = () => new HttpError(401, 'unauthenticated', 'Please sign in');

/** Loads the signed-in user from the session cookie, or responds 401. */
export function requireAuth({ db, config }: AppDeps): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) throw unauthenticated();
    const auth = await findSession(db, token);
    if (!auth) throw unauthenticated();
    const newExpiry = await extendSessionIfStale(db, auth, config.sessionTtlMs);
    if (newExpiry) setSessionCookie(res, token, newExpiry, config.cookieSecure);
    req.auth = auth;
    next();
  };
}

/** The signed-in user. Only call this on routes behind requireAuth. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (getAuth(req).role !== role) {
      throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
    }
    next();
  };
}
