import { Redis, type RedisOptions } from 'ioredis';
import type { Logger } from './logger';

/**
 * A Redis connection that reconnects forever and logs each outage once instead of on every retry.
 * Redis only holds rebuildable state (queues, progress events), so the app keeps running while it's down.
 */
export function createRedis(url: string, name: string, logger: Logger, options: RedisOptions = {}): Redis {
  const redis = new Redis(url, {
    connectionName: `stockroom-${name}`,
    // BullMQ needs this for workers. Commands wait for a reconnect instead of failing after a few retries.
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    ...options,
  });
  let down = false;
  redis.on('error', (err) => {
    if (down) return;
    down = true;
    logger.warn({ err: err.message, connection: name }, 'Redis is unavailable; retrying in the background');
  });
  redis.on('ready', () => {
    if (down) logger.info({ connection: name }, 'Redis is back');
    down = false;
  });
  return redis;
}

/** Resolves with the promise's value, or rejects if it takes longer than ms. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Deletes every key under a prefix. Used by tests to clean up after themselves. */
export async function deleteKeysWithPrefix(redis: Redis, prefix: string) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}
