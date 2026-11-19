import type { SessionUser, TransferSummary } from '@stockroom/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { tenants } from '../src/db/schema';
import { deleteExpiredDemos } from '../src/modules/demo/service';
import { processImport } from '../src/modules/imports/process';
import { createImport, getImportDetail } from '../src/modules/imports/service';
import { PASSWORD, setupTestApp, signUp, silentLogger } from './helpers';

const { app, db } = setupTestApp();
const { app: fullApp } = setupTestApp({ demo: { enabled: true, ttlMs: 86_400_000, maxActive: 0, rateLimit: 1000 } });
const { app: limitedApp } = setupTestApp({ demo: { enabled: true, ttlMs: 86_400_000, maxActive: 1000, rateLimit: 2 } });
const { app: closedApp } = setupTestApp({ signupsEnabled: false, demo: { enabled: false, ttlMs: 1, maxActive: 1, rateLimit: 1 } });

async function startDemo() {
  const visitor = request.agent(app);
  const res = await visitor.post('/api/demo');
  expect(res.status).toBe(201);
  return { visitor, user: res.body.user as SessionUser };
}

describe('demo sandboxes', () => {
  it('gives each visitor a private, fully stocked business that expires in a day', async () => {
    const { visitor, user } = await startDemo();
    expect(user).toMatchObject({ name: 'Demo Owner', role: 'owner', tenant: { name: 'Maple & Pine Supply Co.' } });
    const hoursLeft = (new Date(user.tenant.demoExpiresAt!).getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);

    expect((await visitor.get('/api/products')).body.total).toBe(136);
    expect((await visitor.get('/api/stores')).body.items).toHaveLength(3);
    expect((await visitor.get('/api/alerts')).body.total).toBeGreaterThan(0);
    const transfers = (await visitor.get('/api/transfers')).body.items as TransferSummary[];
    expect(transfers.map((t) => t.status).sort()).toEqual(['in_transit', 'received']);
    expect((await visitor.get('/api/auth/me')).body.user.tenant.demoExpiresAt).toBe(user.tenant.demoExpiresAt);
  });

  it('keeps every visitor’s demo separate', async () => {
    const a = await startDemo();
    const b = await startDemo();
    expect(a.user.tenant.id).not.toBe(b.user.tenant.id);
    const product = (await a.visitor.get('/api/products').query({ pageSize: 1 })).body.items[0];
    await a.visitor.patch(`/api/products/${product.id}`).send({ name: 'Renamed by A' });
    expect((await b.visitor.get(`/api/products/${product.id}`)).status).toBe(404);
  });

  it("can't be signed into with a password", async () => {
    const { user } = await startDemo();
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('is deleted when it expires, ending its session, and leaves real businesses alone', async () => {
    const { visitor, user } = await startDemo();
    const real = await signUp(app);
    await db.update(tenants).set({ demoExpiresAt: new Date(Date.now() - 1000) }).where(eq(tenants.id, user.tenant.id));

    expect(await deleteExpiredDemos(db)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(tenants).where(eq(tenants.id, user.tenant.id))).toEqual([]);
    expect((await visitor.get('/api/products')).status).toBe(401);
    expect((await real.agent.get('/api/products')).status).toBe(200);
  });

  it('caps how many demos can exist at once', async () => {
    const res = await request(fullApp).post('/api/demo');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('demo_busy');
  });

  it('limits how many demos one visitor can start', async () => {
    expect((await request(limitedApp).post('/api/demo')).status).toBe(201);
    expect((await request(limitedApp).post('/api/demo')).status).toBe(201);
    const third = await request(limitedApp).post('/api/demo');
    expect(third.status).toBe(429);
  });

  it('limits imports in demos to a smaller size', async () => {
    const { user } = await startDemo();
    const rows = Array.from({ length: 6 }, (_, i) => `DEMO-${i},Item ${i},1`);
    const { summary } = await createImport(db, {
      tenantId: user.tenant.id,
      userId: user.id,
      fileName: 'too-big.csv',
      content: Buffer.from(['sku,name,price', ...rows].join('\n')),
      format: 'csv',
    });
    expect(await processImport(db, summary.id, { chunkSize: 100, logger: silentLogger, demoMaxRows: 5, maxRows: 100 })).toBe('failed');
    const detail = await getImportDetail(db, user.tenant.id, summary.id);
    expect(detail.failureReason).toBe('The file has 6 rows. The limit for demo businesses is 5.');
    expect(detail.createdCount).toBe(0);
  });

  it('tells the sign-in page what is on offer, and honours the switches', async () => {
    expect((await request(app).get('/api/config')).body).toMatchObject({ signupsEnabled: true, demoEnabled: true, demoImportMaxRows: 2000 });
    expect((await request(closedApp).get('/api/config')).body).toMatchObject({ signupsEnabled: false, demoEnabled: false });
    expect((await request(closedApp).post('/api/demo')).status).toBe(404);
    const register = await request(closedApp)
      .post('/api/auth/register')
      .send({ businessName: 'Nope', name: 'Nope', email: 'nope@example.com', password: PASSWORD });
    expect(register.status).toBe(403);
    expect(register.body.error.code).toBe('signups_disabled');
  });
});
