import {
  WEBHOOK_TEST_EVENT,
  webhookEndpointCreateSchema,
  webhookEndpointUpdateSchema,
  webhookEventTypes,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType,
} from '@stockroom/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import type { Executor } from '../../db/client';
import { webhookDeliveries, webhookEndpoints } from '../../db/schema';
import { getAuth, requireRole } from '../../http/auth';
import { HttpError, notFound } from '../../http/errors';
import { parse, parseId } from '../../http/validate';
import { recordEvent } from '../events/outbox';
import { newWebhookSecret } from './delivery';
import { assertDeliverableUrl, UnsafeUrlError } from './safe-http';

const MAX_ENDPOINTS = 5;

const endpointColumns = {
  id: webhookEndpoints.id,
  url: webhookEndpoints.url,
  description: webhookEndpoints.description,
  eventTypes: webhookEndpoints.eventTypes,
  enabled: webhookEndpoints.enabled,
  createdAt: webhookEndpoints.createdAt,
  lastStatus: sql<string | null>`(select status from ${webhookDeliveries} d where d.endpoint_id = ${webhookEndpoints.id} order by d.created_at desc limit 1)`,
  lastAt: sql<string | null>`(select coalesce(delivered_at, updated_at) from ${webhookDeliveries} d where d.endpoint_id = ${webhookEndpoints.id} order by d.created_at desc limit 1)`,
};

async function listEndpoints(db: Executor, tenantId: string, id?: string): Promise<WebhookEndpoint[]> {
  const rows = await db
    .select(endpointColumns)
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), id ? eq(webhookEndpoints.id, id) : undefined))
    .orderBy(webhookEndpoints.createdAt);
  return rows.map(({ lastStatus, lastAt, ...e }) => ({
    ...e,
    eventTypes: e.eventTypes as WebhookEventType[],
    createdAt: e.createdAt.toISOString(),
    lastDelivery: lastStatus && lastAt ? { status: lastStatus as WebhookDelivery['status'], at: new Date(lastAt).toISOString() } : null,
  }));
}

async function getEndpoint(db: Executor, tenantId: string, id: string) {
  const [endpoint] = await listEndpoints(db, tenantId, id);
  if (!endpoint) throw notFound('Webhook endpoint');
  return endpoint;
}

/** Webhook endpoints. Owners only: an endpoint receives business data. */
export function webhooksRouter(deps: AppDeps) {
  const { db, config, outbox } = deps;
  const router = Router();
  router.use(requireRole('owner'));

  const checkUrl = async (url: string) => {
    try {
      await assertDeliverableUrl(url, { allowPrivate: config.webhooksAllowPrivate });
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw new HttpError(400, 'validation_failed', 'Some fields are invalid', [{ path: 'url', message: err.message }]);
      throw err;
    }
  };

  router.get('/', async (req, res) => {
    res.json({ items: await listEndpoints(db, getAuth(req).tenant.id) });
  });

  router.post('/', async (req, res) => {
    const { tenant } = getAuth(req);
    const input = parse(webhookEndpointCreateSchema, req.body);
    await checkUrl(input.url);
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenant.id));
    if (count >= MAX_ENDPOINTS) throw new HttpError(409, 'too_many_endpoints', `You can have at most ${MAX_ENDPOINTS} webhook endpoints`);

    const secret = newWebhookSecret();
    const [created] = await db
      .insert(webhookEndpoints)
      .values({
        tenantId: tenant.id,
        url: input.url,
        description: input.description || null,
        secret,
        eventTypes: input.eventTypes ?? [...webhookEventTypes],
      })
      .returning({ id: webhookEndpoints.id });
    // The secret is returned once. The endpoint list never includes it.
    res.status(201).json({ ...(await getEndpoint(db, tenant.id, created!.id)), secret });
  });

  router.patch('/:id', async (req, res) => {
    const { tenant } = getAuth(req);
    const id = parseId(req.params.id, 'Webhook endpoint');
    const input = parse(webhookEndpointUpdateSchema, req.body);
    const [updated] = await db
      .update(webhookEndpoints)
      .set({ ...input, updatedAt: sql`now()` })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.tenantId, tenant.id)))
      .returning({ id: webhookEndpoints.id });
    if (!updated) throw notFound('Webhook endpoint');
    res.json(await getEndpoint(db, tenant.id, id));
  });

  router.delete('/:id', async (req, res) => {
    const { tenant } = getAuth(req);
    const id = parseId(req.params.id, 'Webhook endpoint');
    const [deleted] = await db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.tenantId, tenant.id)))
      .returning({ id: webhookEndpoints.id });
    if (!deleted) throw notFound('Webhook endpoint');
    res.status(204).end();
  });

  /** Sends a test event through the same outbox, relay and delivery path as real events. */
  router.post('/:id/test', async (req, res) => {
    const { tenant } = getAuth(req);
    const endpoint = await getEndpoint(db, tenant.id, parseId(req.params.id, 'Webhook endpoint'));
    if (!endpoint.enabled) throw new HttpError(409, 'endpoint_disabled', 'Turn the endpoint on before sending a test');
    await recordEvent(db, tenant.id, WEBHOOK_TEST_EVENT, { endpointId: endpoint.id, message: 'Test event from Stockroom' });
    outbox.poke();
    res.status(202).json({ queued: true });
  });

  router.get('/:id/deliveries', async (req, res) => {
    const { tenant } = getAuth(req);
    const endpoint = await getEndpoint(db, tenant.id, parseId(req.params.id, 'Webhook endpoint'));
    const rows = await db
      .select({
        id: webhookDeliveries.id,
        eventId: webhookDeliveries.eventId,
        eventType: webhookDeliveries.eventType,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        lastStatusCode: webhookDeliveries.lastStatusCode,
        lastError: webhookDeliveries.lastError,
        createdAt: webhookDeliveries.createdAt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpoint.id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    res.json({ items: rows });
  });

  return router;
}
