import { randomUUID } from 'node:crypto';
import type { ProductCreateInput, SessionUser, Store } from '@stockroom/shared';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, expect, inject } from 'vitest';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { createDb } from '../src/db/client';

export function setupTestApp(overrides: Partial<Config> = {}) {
  const { db, pool } = createDb(inject('databaseUrl'), 20);
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
    ...overrides,
  };
  const app = createApp({ config, db, pool, logger: pino({ level: 'silent' }) });
  afterAll(() => pool.end());
  return { app, db, pool };
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
