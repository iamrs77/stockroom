import { createHmac, randomBytes } from 'node:crypto';
import type { WebhookEvent } from '@stockroom/shared';
import { Queue, Worker } from 'bullmq';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Db } from '../../db/client';
import { outboxEvents, webhookDeliveries, webhookEndpoints } from '../../db/schema';
import type { Logger } from '../../logger';
import { webhookAttempts } from '../../metrics';
import { createRedis, withTimeout } from '../../redis';
import { postJson } from './safe-http';

export const WEBHOOK_QUEUE = 'webhooks';
/** With a 10 s base delay, 8 attempts spread retries over roughly 20 minutes. */
const ATTEMPTS = 8;

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/**
 * Stripe-style signature: HMAC-SHA256 of "<timestamp>.<body>". Receivers recompute it with their
 * secret to check the request came from Stockroom, and reject old timestamps to stop replays.
 */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export type WebhookQueue = {
  enqueue(deliveryId: string): Promise<boolean>;
  close(): Promise<void>;
  queue: Queue<{ deliveryId: string }>;
};

export function createWebhookQueue({
  connection,
  prefix,
  logger,
  retryDelayMs,
}: {
  connection: Redis;
  prefix: string;
  logger: Logger;
  retryDelayMs: number;
}): WebhookQueue {
  const queue = new Queue<{ deliveryId: string }>(WEBHOOK_QUEUE, {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: ATTEMPTS,
      backoff: { type: 'exponential', delay: retryDelayMs },
      removeOnComplete: { count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return {
    queue,
    async enqueue(deliveryId) {
      try {
        // The job id is the delivery id, so queueing a delivery twice is a no-op.
        await withTimeout(queue.add('deliver', { deliveryId }, { jobId: deliveryId }), 3000, 'Queueing a webhook');
        return true;
      } catch (err) {
        logger.warn({ err: (err as Error).message, deliveryId }, 'Could not queue a webhook; the sweeper will retry');
        return false;
      }
    },
    close: () => queue.close(),
  };
}

export type WebhookWorkerOptions = {
  db: Db;
  redisUrl: string;
  prefix: string;
  logger: Logger;
  webhookQueue: WebhookQueue;
  allowPrivate: boolean;
  timeoutMs: number;
  sweepEveryMs?: number;
  staleAfterMs?: number;
};

/** Sends one delivery attempt and records the outcome. Throws on failure so the queue retries. */
export async function attemptDelivery(db: Db, deliveryId: string, options: { allowPrivate: boolean; timeoutMs: number }) {
  const [row] = await db
    .select({
      status: webhookDeliveries.status,
      url: webhookEndpoints.url,
      secret: webhookEndpoints.secret,
      enabled: webhookEndpoints.enabled,
      eventId: outboxEvents.eventId,
      type: outboxEvents.type,
      payload: outboxEvents.payload,
      createdAt: outboxEvents.createdAt,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .innerJoin(outboxEvents, eq(outboxEvents.eventId, webhookDeliveries.eventId))
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!row || row.status !== 'pending') return; // already delivered, given up, or the endpoint was deleted
  if (!row.enabled) {
    await db
      .update(webhookDeliveries)
      .set({ status: 'failed', lastError: 'The endpoint was disabled', updatedAt: sql`now()` })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  const event: WebhookEvent = { id: row.eventId, type: row.type, createdAt: row.createdAt.toISOString(), data: row.payload };
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const result = await postJson(
    row.url,
    body,
    {
      'User-Agent': 'Stockroom-Webhooks/1.0',
      'Stockroom-Event-Id': row.eventId,
      'Stockroom-Event-Type': row.type,
      'Stockroom-Signature': signWebhook(row.secret, timestamp, body),
    },
    options,
  );
  const ok = result.status !== undefined && result.status >= 200 && result.status < 300;
  webhookAttempts.inc({ outcome: ok ? 'delivered' : 'failed' });
  await db
    .update(webhookDeliveries)
    .set({
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      lastStatusCode: result.status ?? null,
      lastError: ok ? null : (result.error ?? `The endpoint answered ${result.status}`),
      status: ok ? 'succeeded' : 'pending',
      deliveredAt: ok ? sql`now()` : null,
      updatedAt: sql`now()`,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!ok) throw new Error(result.error ?? `HTTP ${result.status}`);
}

export function startWebhookWorker(options: WebhookWorkerOptions) {
  const { db, logger, webhookQueue } = options;
  const connection = createRedis(options.redisUrl, 'webhook-worker', logger);
  const worker = new Worker<{ deliveryId: string }>(
    WEBHOOK_QUEUE,
    (job) => attemptDelivery(db, job.data.deliveryId, options),
    // Deliveries mostly wait on the network, so several can run at once without using much CPU.
    { connection, prefix: options.prefix, concurrency: 5 },
  );
  worker.on('failed', (job, err) => {
    if (!job) return;
    void (async () => {
      try {
        if ((await job.getState()) !== 'failed') return; // BullMQ will retry
        await db
          .update(webhookDeliveries)
          .set({ status: 'failed', updatedAt: sql`now()` })
          .where(and(eq(webhookDeliveries.id, job.data.deliveryId), eq(webhookDeliveries.status, 'pending')));
        logger.warn({ deliveryId: job.data.deliveryId, err: err.message }, 'Gave up on a webhook delivery');
      } catch (failErr) {
        logger.error({ err: failErr }, 'Could not mark a webhook delivery failed');
      }
    })();
  });
  worker.on('error', (err) => logger.warn({ err: err.message }, 'Webhook worker error'));

  // Same repair loop as imports: Postgres says which deliveries are owed, the queue only carries them.
  const staleAfterMs = options.staleAfterMs ?? 15 * 60_000;
  const sweep = async () => {
    try {
      const stale = await db
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.status, 'pending'), lt(webhookDeliveries.updatedAt, new Date(Date.now() - staleAfterMs))))
        .limit(200);
      for (const { id } of stale) await webhookQueue.enqueue(id);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Webhook sweep failed');
    }
  };
  const sweeper = setInterval(sweep, options.sweepEveryMs ?? 5 * 60_000);
  sweeper.unref();

  return {
    worker,
    sweep,
    async close() {
      clearInterval(sweeper);
      await worker.close();
      connection.disconnect();
    },
  };
}
