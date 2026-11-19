import type { PublicConfig } from '@stockroom/shared';
import { Router } from 'express';
import type { AppDeps } from '@/app';
import { HttpError } from '@/http/errors';
import { rateLimiter } from '@/http/rate-limit';
import { createSession, setSessionCookie, toSessionUser } from '@/modules/auth/sessions';
import { createDemoBusiness } from './service';

/** Public routes: what the sign-in page offers, and "Try the demo". */
export function demoRouter(deps: AppDeps) {
  const { db, config, logger } = deps;
  const router = Router();

  router.get('/config', (_req, res) => {
    const publicConfig: PublicConfig = {
      signupsEnabled: config.signupsEnabled,
      demoEnabled: config.demo.enabled,
      importMaxRows: config.importMaxRows,
      demoImportMaxRows: config.demoImportMaxRows,
      demoHours: Math.round(config.demo.ttlMs / 3_600_000),
    };
    res.json(publicConfig);
  });

  // Creating a demo writes ~700 rows, so it's limited per visitor, and the total number is capped.
  const limiter = rateLimiter({
    windowMs: 60 * 60 * 1000,
    limit: config.demo.rateLimit,
    message: "You've started several demos recently. Please try again later.",
  });

  router.post('/demo', limiter, async (_req, res) => {
    if (!config.demo.enabled) throw new HttpError(404, 'not_found', 'The demo is turned off here');
    const user = await createDemoBusiness(db, config, logger);
    // The session ends when the demo business is deleted.
    const session = await createSession(db, user.id, user.sessionTtlMs);
    setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
    res.status(201).json({ user: toSessionUser(user) });
  });

  return router;
}
