import {
  WEBHOOK_TEST_EVENT,
  webhookEventTypes,
  type webhookEndpointCreateSchema,
  type webhookEndpointUpdateSchema,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType,
} from '@stockroom/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, Executor } from '@/db/client';
import { webhookDeliveries, webhookEndpoints } from '@/db/schema';
import { HttpError, notFound } from '@/http/errors';
import { recordEvent } from '@/modules/events/outbox';
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

/** A business's endpoints, each with how its latest delivery went. Never includes the signing secrets. */
export async function listEndpoints(db: Executor, tenantId: string, id?: string): Promise<WebhookEndpoint[]> {
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

export async function getEndpoint(db: Executor, tenantId: string, id: string) {
  const [endpoint] = await listEndpoints(db, tenantId, id);
  if (!endpoint) throw notFound('Webhook endpoint');
  return endpoint;
}

/** Checks a URL is one Stockroom will send to (https, resolvable, not private), as a field error on `url`. */
async function checkUrl(url: string, allowPrivate: boolean) {
  try {
    await assertDeliverableUrl(url, { allowPrivate });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new HttpError(400, 'validation_failed', 'Some fields are invalid', [{ path: 'url', message: err.message }]);
    throw err;
  }
}

/**
 * Adds an endpoint with a new signing secret, after checking its URL is safe to send to and the
 * business is under the endpoint limit. The secret is returned here once; the endpoint list never includes it.
 */
export async function createEndpoint(
  db: Db,
  tenantId: string,
  input: z.output<typeof webhookEndpointCreateSchema>,
  { allowPrivate }: { allowPrivate: boolean },
) {
  await checkUrl(input.url, allowPrivate);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, tenantId));
  if (count >= MAX_ENDPOINTS) throw new HttpError(409, 'too_many_endpoints', `You can have at most ${MAX_ENDPOINTS} webhook endpoints`);

  const secret = newWebhookSecret();
  const [created] = await db
    .insert(webhookEndpoints)
    .values({
      tenantId,
      url: input.url,
      description: input.description || null,
      secret,
      eventTypes: input.eventTypes ?? [...webhookEventTypes],
    })
    .returning({ id: webhookEndpoints.id });
  return { ...(await getEndpoint(db, tenantId, created!.id)), secret };
}

export async function updateEndpoint(db: Db, tenantId: string, id: string, input: z.output<typeof webhookEndpointUpdateSchema>) {
  const [updated] = await db
    .update(webhookEndpoints)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.tenantId, tenantId)))
    .returning({ id: webhookEndpoints.id });
  if (!updated) throw notFound('Webhook endpoint');
  return getEndpoint(db, tenantId, id);
}

export async function deleteEndpoint(db: Db, tenantId: string, id: string) {
  const [deleted] = await db
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.tenantId, tenantId)))
    .returning({ id: webhookEndpoints.id });
  if (!deleted) throw notFound('Webhook endpoint');
}

/**
 * Records a test event in the outbox, so it goes through the same relay and delivery path as real
 * events. The caller pokes the outbox afterwards to send it promptly.
 */
export async function recordTestEvent(db: Db, tenantId: string, id: string) {
  const endpoint = await getEndpoint(db, tenantId, id);
  if (!endpoint.enabled) throw new HttpError(409, 'endpoint_disabled', 'Turn the endpoint on before sending a test');
  await recordEvent(db, tenantId, WEBHOOK_TEST_EVENT, { endpointId: endpoint.id, message: 'Test event from Stockroom' });
}

/** An endpoint's 50 most recent deliveries, newest first. */
export async function listDeliveries(db: Db, tenantId: string, id: string) {
  const endpoint = await getEndpoint(db, tenantId, id);
  return db
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
}
