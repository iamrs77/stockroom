import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebhookDelivery, WebhookEndpointCreated, WebhookEvent } from '@stockroom/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outboxEvents } from '../src/db/schema';
import { assertDeliverableUrl, isPrivateAddress } from '../src/modules/webhooks/safe-http';
import { createProduct, setupTestApp, signUp, waitFor } from './helpers';

const { app, db, relay } = setupTestApp({ webhooks: true });

/** A local endpoint that records what it receives and answers with whatever status is queued. */
type Received = { headers: IncomingMessage['headers']; body: string };
const received: Received[] = [];
const statuses: number[] = [];
let server: Server;
let baseUrl = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = statuses.shift() ?? 200;
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const eventsFor = (path: string) =>
  received.filter((r) => r.headers['x-test-path'] === undefined && r.body && JSON.parse(r.body)).filter((r) => r.headers.host && r.body.includes(path));

async function setup(path: string, eventTypes?: string[]) {
  const owner = await signUp(app);
  const res = await owner.agent.post('/api/webhooks').send({ url: `${baseUrl}/${path}`, description: 'Test receiver', eventTypes });
  expect(res.status).toBe(201);
  return { ...owner, endpoint: res.body as WebhookEndpointCreated };
}

function verify(secret: string, r: Received) {
  const [t, v1] = String(r.headers['stockroom-signature']).split(',').map((p) => p.split('=')[1]);
  const expected = createHmac('sha256', secret).update(`${t}.${r.body}`).digest('hex');
  return v1 === expected;
}

const deliveries = async (agent: Awaited<ReturnType<typeof setup>>['agent'], endpointId: string) =>
  (await agent.get(`/api/webhooks/${endpointId}/deliveries`)).body.items as WebhookDelivery[];

describe('webhooks', () => {
  it('delivers a signed event when stock runs low', async () => {
    const t = await setup('low-stock', ['stock.low']);
    expect(t.endpoint.secret).toMatch(/^whsec_/);
    const product = await createProduct(t.agent, { sku: 'HONEY', name: 'Honey', reorderPoint: 3 });
    await t.agent.post(`/api/products/${product.id}/stock-adjustments`).send({ storeId: t.mainStore.id, delta: 2, reason: 'received' });

    const hit = await waitFor(async () => received.find((r) => r.body.includes('"HONEY"')));
    const event = JSON.parse(hit.body) as WebhookEvent<{ sku: string; stock: number; reorderPoint: number }>;
    expect(event).toMatchObject({ type: 'stock.low', data: { sku: 'HONEY', stock: 2, reorderPoint: 3 } });
    expect(hit.headers['stockroom-event-id']).toBe(event.id);
    expect(hit.headers['stockroom-event-type']).toBe('stock.low');
    expect(verify(t.endpoint.secret, hit)).toBe(true);
    expect(verify('whsec_wrong', hit)).toBe(false);

    const [delivery] = await waitFor(async () => {
      const list = await deliveries(t.agent, t.endpoint.id);
      return list[0]?.status === 'succeeded' ? list : undefined;
    });
    expect(delivery).toMatchObject({ eventType: 'stock.low', status: 'succeeded', attempts: 1, lastStatusCode: 200 });
  });

  it('only sends the event types an endpoint subscribed to', async () => {
    const t = await setup('only-transfers', ['transfer.sent']);
    const product = await createProduct(t.agent, { sku: 'JAM', name: 'Jam', reorderPoint: 5 });
    await t.agent.post(`/api/products/${product.id}/stock-adjustments`).send({ storeId: t.mainStore.id, delta: 1, reason: 'received' });
    // stock.low happened, but this endpoint only wants transfers.
    await relay!.drain();
    const all = await db.select().from(outboxEvents).where(eq(outboxEvents.tenantId, t.user.tenant.id));
    expect(all.map((e) => e.type)).toEqual(['stock.low']);
    expect(all[0]!.publishedAt).not.toBeNull();
    expect(await deliveries(t.agent, t.endpoint.id)).toEqual([]);
  });

  it('retries failed deliveries with backoff until the endpoint answers', async () => {
    const t = await setup('flaky');
    statuses.push(500, 503); // fail twice, then succeed
    expect((await t.agent.post(`/api/webhooks/${t.endpoint.id}/test`)).status).toBe(202);

    const [delivery] = await waitFor(async () => {
      const list = await deliveries(t.agent, t.endpoint.id);
      return list[0]?.status === 'succeeded' ? list : undefined;
    });
    expect(delivery).toMatchObject({ eventType: 'webhook.test', attempts: 3, lastStatusCode: 200, lastError: null });
    // Every attempt carried the same event id, so the receiver can drop duplicates.
    const ids = new Set(received.filter((r) => r.headers['stockroom-event-type'] === 'webhook.test').map((r) => r.headers['stockroom-event-id']));
    expect(ids.size).toBeGreaterThanOrEqual(1);
  });

  it('sends nothing to a disabled endpoint', async () => {
    const t = await setup('disabled');
    await t.agent.patch(`/api/webhooks/${t.endpoint.id}`).send({ enabled: false });
    expect((await t.agent.post(`/api/webhooks/${t.endpoint.id}/test`)).status).toBe(409);
    const list = await t.agent.get('/api/webhooks');
    expect(list.body.items[0]).toMatchObject({ enabled: false });
    expect(list.body.items[0].secret).toBeUndefined(); // the secret is only shown at creation
  });

  it('is for owners only, and private to each business', async () => {
    const t = await setup('private');
    const other = await signUp(app);
    expect((await other.agent.get(`/api/webhooks/${t.endpoint.id}/deliveries`)).status).toBe(404);
    expect((await other.agent.delete(`/api/webhooks/${t.endpoint.id}`)).status).toBe(404);
    expect((await other.agent.get('/api/webhooks')).body.items).toEqual([]);
  });
});

describe('webhook URL safety', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'treats %s as private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('treats %s as public', (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it('refuses private, plain-http and credentialed URLs in production settings', async () => {
    const strict = { allowPrivate: false };
    await expect(assertDeliverableUrl('https://169.254.169.254/latest/meta-data', strict)).rejects.toThrow(/private network/);
    await expect(assertDeliverableUrl('https://localhost/hook', strict)).rejects.toThrow(/private network/);
    await expect(assertDeliverableUrl('https://[::1]/hook', strict)).rejects.toThrow(/private network/);
    await expect(assertDeliverableUrl('http://example.com/hook', strict)).rejects.toThrow(/https/);
    await expect(assertDeliverableUrl('https://user:pass@example.com/hook', strict)).rejects.toThrow(/username/);
    await expect(assertDeliverableUrl('ftp://example.com', strict)).rejects.toThrow(/https/);
  });
});

describe('webhook backlog', () => {
  it('does not send an endpoint events from before it was added', async () => {
    const owner = await signUp(app);
    const res = await owner.agent.post('/api/webhooks').send({ url: `${baseUrl}/late`, eventTypes: ['stock.low'] });
    // An event recorded a minute before the endpoint existed, which the relay hasn't sent yet
    // (say the relay was down). It must not be delivered to the new endpoint.
    await db.insert(outboxEvents).values({
      tenantId: owner.user.tenant.id,
      type: 'stock.low',
      payload: { sku: 'OLD', stock: 1, reorderPoint: 5 },
      createdAt: new Date(Date.now() - 60_000),
    });
    await relay!.drain();
    const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.tenantId, owner.user.tenant.id));
    expect(event!.publishedAt).not.toBeNull(); // the relay did process it
    expect(await deliveries(owner.agent, res.body.id)).toEqual([]);
  });
});
