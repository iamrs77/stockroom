import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { HttpError } from './errors';

/**
 * Allows each client IP `limit` requests per window, then answers 429 with `message`.
 * The count is kept in memory, so it is per process; see docs/adr/0004.
 */
export function rateLimiter({ windowMs, limit, message }: { windowMs: number; limit: number; message: string }): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: () => {
      throw new HttpError(429, 'too_many_requests', message);
    },
  });
}
