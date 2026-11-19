import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../app';
import { idempotencyKeys } from '../db/schema';
import { getAuth } from './auth';
import { HttpError } from './errors';

/** A first request that hasn't finished after this long is assumed to have crashed. */
const IN_PROGRESS_TIMEOUT_MS = 60_000;

/**
 * Makes a POST safe to retry. When a request carries an Idempotency-Key header:
 *  - the first request runs and its response is stored;
 *  - a retry with the same key and body gets the stored response back, and the work isn't repeated;
 *  - the same key with a different body is rejected (422);
 *  - a retry while the first request is still running is rejected (409), so the client retries later.
 * Server errors (5xx) aren't stored, so the client can retry them with the same key.
 */
export function idempotent({ db, logger }: AppDeps): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next();
    if (key.length > 255) {
      throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be at most 255 characters');
    }

    const { tenant } = getAuth(req);
    const requestHash = createHash('sha256')
      .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
      .digest('hex');
    const keyFilter = and(eq(idempotencyKeys.tenantId, tenant.id), eq(idempotencyKeys.key, key));

    const claimed = await db
      .insert(idempotencyKeys)
      .values({ tenantId: tenant.id, key, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      const [existing] = await db.select().from(idempotencyKeys).where(keyFilter);
      if (!existing) {
        throw new HttpError(409, 'request_in_progress', 'This request is still being processed. Try again shortly.');
      }
      if (existing.requestHash !== requestHash) {
        throw new HttpError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request');
      }
      if (existing.statusCode !== null) {
        res.set('Idempotent-Replayed', 'true');
        res.status(existing.statusCode).json(existing.responseBody);
        return;
      }
      if (Date.now() - existing.createdAt.getTime() < IN_PROGRESS_TIMEOUT_MS) {
        throw new HttpError(409, 'request_in_progress', 'This request is still being processed. Try again shortly.');
      }
      // The first attempt never finished (e.g. the server restarted), so this request takes it over.
      await db.update(idempotencyKeys).set({ createdAt: new Date() }).where(keyFilter);
    }

    // Store the response before sending it, so a retry that arrives right after sees it.
    const sendJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      const save =
        status >= 500
          ? db.delete(idempotencyKeys).where(keyFilter)
          : db.update(idempotencyKeys).set({ statusCode: status, responseBody: body }).where(keyFilter);
      save.then(
        () => sendJson(body),
        (err: unknown) => {
          logger.error({ err, key }, 'Could not save the idempotent response');
          sendJson(body);
        },
      );
      return res;
    };
    next();
  };
}
