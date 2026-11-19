import { and, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { idempotencyKeys, outboxEvents, sessions } from '../../db/schema';
import type { Logger } from '../../logger';

const HOUR = 60 * 60 * 1000;

/**
 * Deletes data that has served its purpose, so tables stay small on a free database:
 * idempotency keys after a day (clients retry within minutes), expired sessions, and published
 * outbox events after a week (their webhook delivery log goes with them).
 */
export async function cleanUp(db: Db) {
  const now = Date.now();
  const keys = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(now - 24 * HOUR))).returning({ key: idempotencyKeys.key });
  const expired = await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now))).returning({ id: sessions.id });
  const events = await db
    .delete(outboxEvents)
    .where(and(isNotNull(outboxEvents.publishedAt), lt(outboxEvents.publishedAt, new Date(now - 7 * 24 * HOUR))))
    .returning({ id: outboxEvents.id });
  return { idempotencyKeys: keys.length, sessions: expired.length, events: events.length };
}

export function startJanitor({ db, logger, everyMs = HOUR }: { db: Db; logger: Logger; everyMs?: number }) {
  const run = async () => {
    try {
      const removed = await cleanUp(db);
      if (removed.idempotencyKeys || removed.sessions || removed.events) logger.info({ removed }, 'Cleaned up old data');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Clean-up failed');
    }
  };
  const timer = setInterval(run, everyMs);
  timer.unref();
  return { close: () => clearInterval(timer) };
}
