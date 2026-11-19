import { randomUUID } from 'node:crypto';
import type { ProductCreateInput, SessionUser, Store } from '@stockroom/shared';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, expect, inject } from 'vitest';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { createDb } from '../src/db/client';
import { ImportEvents } from '../src/modules/imports/events';
import { createImportQueue, startImportWorker } from '../src/modules/imports/queue';
import { createRedis, deleteKeysWithPrefix } from '../src/redis';

export const silentLogger = pino({ level: 'silent' });

type Options = Partial<Config> & {
  /** Also run an import worker in this test file. */
  worker?: boolean;
};

export function setupTestApp({ worker: withWorker = false, ...overrides }: Options = {}) {
  const { db, pool } = createDb(inject('databaseUrl'), 20);
  const redisUrl = inject('redisUrl');
  // Each test file gets its own Redis key prefix, so files never share queues or events.
  const prefix = `stockroom-test-${randomUUID().slice(0, 8)}`;
  const config: Config = {
    env: 'test',
    isProduction: false,
    port: 0,
    databaseUrl: inject('databaseUrl'),
    databasePoolMax: 20,
    logLevel: 'silent',
    sessionTtlMs: 14 * 24 * 60 * 60 * 1000,
    authRateLimit: 10_000,
    cookieSecure: false,
    role: 'all',
    redisUrl,
    redisPrefix: prefix,
    importConcurrency: 2,
    importChunkSize: 1000,
    ...overrides,
  };

  const redis = createRedis(redisUrl, 'test-commands', silentLogger);
  const subscriber = createRedis(redisUrl, 'test-subscriber', silentLogger);
  const events = new ImportEvents({ prefix, logger: silentLogger, publisher: redis, subscriber });
  const importQueue = createImportQueue({ connection: redis, prefix, logger: silentLogger });
  const worker = withWorker
    ? startImportWorker({
        db,
        redisUrl,
        prefix,
        logger: silentLogger,
        events,
        importQueue,
        concurrency: config.importConcurrency,
        chunkSize: config.importChunkSize,
      })
    : undefined;

  const app = createApp({ config, db, pool, logger: silentLogger, imports: { queue: importQueue, events } });

  afterAll(async () => {
    await worker?.close();
    await importQueue.close();
    await deleteKeysWithPrefix(redis, prefix);
    subscriber.disconnect();
    redis.disconnect();
    await pool.end();
  });
  return { app, db, pool, importQueue, events, worker, prefix };
}

type App = ReturnType<typeof setupTestApp>['app'];

export const PASSWORD = 'correct-horse-battery';

/** Signs up a new business and returns a signed-in agent (it keeps the session cookie). */
export async function signUp(app: App, businessName = 'Test Shop') {
  const agent = request.agent(app);
  const email = `owner-${randomUUID()}@example.com`;
  const res = await agent.post('/api/auth/register').send({ businessName, name: 'Owner', email, password: PASSWORD });
  expect(res.status).toBe(201);
  const stores = await agent.get('/api/stores');
  return {
    agent,
    email,
    user: res.body.user as SessionUser,
    mainStore: (stores.body.items as Store[])[0]!,
  };
}

export async function createProduct(agent: request.Agent, overrides: Partial<ProductCreateInput> = {}) {
  const res = await agent.post('/api/products').send({
    sku: `SKU-${randomUUID().slice(0, 8)}`,
    name: 'Ceramic Mug',
    priceCents: 1800,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; sku: string; name: string };
}

/** Polls until the condition holds, for work that finishes in the background. */
export async function waitFor<T>(check: () => Promise<T | undefined | false>, { timeoutMs = 15_000, intervalMs = 100 } = {}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
