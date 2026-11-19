import { WEBHOOK_TEST_EVENT } from '@stockroom/shared';
import { inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Db } from '@/db/client';
import { outboxEvents } from '@/db/schema';
import type { Logger } from '@/logger';
import type { WebhookQueue } from '@/modules/webhooks/delivery';

const BATCH = 100;

/**
 * Moves committed events from the outbox to their destinations: today, a webhook delivery per
 * subscribed endpoint.
 *
 * Several relays can run at once (one per worker process). `FOR UPDATE SKIP LOCKED` hands each
 * batch of events to exactly one of them without the relays waiting on each other. Fanning out
 * and marking events published happen in one transaction, and a delivery is unique per
 * (endpoint, event), so a relay crashing halfway can't produce a duplicate delivery.
 *
 * The relay runs when poked (right after a change commits) and on a slow timer as a safety net.
 * There's no tight polling loop, so an idle database on a free tier can go to sleep.
 */
export function startOutboxRelay(options: { db: Db; logger: Logger; webhookQueue: WebhookQueue; pollEveryMs: number }) {
  const { db, logger, webhookQueue } = options;
  let running: Promise<void> | undefined;
  let again = false;

  async function relayBatch(): Promise<number> {
    const { count, deliveryIds } = await db.transaction(async (tx) => {
      const events = await tx.execute<{ id: number; event_id: string; tenant_id: string; type: string; created_at: Date; endpoint_id: string | null }>(sql`
        select id, event_id, tenant_id, type, created_at, payload->>'endpointId' as endpoint_id
        from outbox_events
        where published_at is null
        order by id
        limit ${BATCH}
        for update skip locked`);
      if (events.rows.length === 0) return { count: 0, deliveryIds: [] as string[] };

      const fanned = await tx.execute<{ id: string }>(sql`
        insert into webhook_deliveries (tenant_id, endpoint_id, event_id, event_type)
        select e.tenant_id, w.id, e.event_id, e.type
        from jsonb_to_recordset(${JSON.stringify(events.rows)}::jsonb)
          as e(event_id uuid, tenant_id uuid, type text, created_at timestamptz, endpoint_id uuid)
        -- An endpoint only gets events from after it was added, not a backlog from before.
        join webhook_endpoints w on w.tenant_id = e.tenant_id and w.enabled and e.created_at >= w.created_at
          and (case when e.type = ${WEBHOOK_TEST_EVENT} then w.id = e.endpoint_id else e.type = any(w.event_types) end)
        on conflict (endpoint_id, event_id) do nothing
        returning id`);
      await tx
        .update(outboxEvents)
        .set({ publishedAt: sql`now()` })
        .where(inArray(outboxEvents.id, events.rows.map((e) => Number(e.id))));
      return { count: events.rows.length, deliveryIds: fanned.rows.map((r) => r.id) };
    });
    // Queued after the commit. If this fails, the deliveries are still recorded and the webhook
    // sweeper queues them later.
    for (const id of deliveryIds) await webhookQueue.enqueue(id);
    return count;
  }

  async function drainOnce() {
    try {
      do {
        again = false;
        while ((await relayBatch()) === BATCH) {
          // full batch: there may be more
        }
      } while (again);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Outbox relay failed; will retry');
    }
  }

  /** Runs the relay now, or once more after the current run if one is in progress. */
  function drain(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = drainOnce().finally(() => {
      running = undefined;
    });
    return running;
  }

  const timer = setInterval(() => void drain(), options.pollEveryMs);
  timer.unref();
  void drain();

  return {
    drain,
    async close() {
      clearInterval(timer);
      await running;
    },
  };
}

/**
 * Tells the relay that new events were committed. In one process (ROLE=all) it calls the relay
 * directly; when the API and worker run separately, the poke travels over Redis.
 */
export function createOutboxPoke(options: { prefix: string; publisher?: Redis; localDrain?: () => Promise<void> }) {
  const channel = `${options.prefix}:outbox-poke`;
  return {
    channel,
    poke() {
      if (options.localDrain) void options.localDrain();
      else options.publisher?.publish(channel, '1').catch(() => {});
    },
  };
}
