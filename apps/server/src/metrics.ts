import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import type pg from 'pg';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { Db } from './db/client';

/**
 * Prometheus metrics. One registry per process. Values that live elsewhere (queue depths, the outbox
 * backlog, the database pool) are read when Prometheus scrapes, so they cost nothing in between.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'stockroom_' }); // event loop lag, heap, GC, CPU

export const httpRequestDuration = new Histogram({
  name: 'stockroom_http_request_duration_seconds',
  help: 'HTTP request duration by route pattern, method and status class',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const importRowsProcessed = new Counter({
  name: 'stockroom_import_rows_processed_total',
  help: 'Spreadsheet rows committed by imports',
  registers: [registry],
});

export const webhookAttempts = new Counter({
  name: 'stockroom_webhook_attempts_total',
  help: 'Webhook delivery attempts by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

/** Records every request's duration. The route is the pattern (/api/products/:id), never the raw URL. */
export const measureRequests: RequestHandler = (req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : req.path.startsWith('/api') ? 'unmatched' : 'static';
    end({ method: req.method, route, status: `${Math.floor(res.statusCode / 100)}xx` });
  });
  next();
};

type QueueLike = { getJobCounts(...types: string[]): Promise<Record<string, number>> };

let runtimeGauges = false;
/** Adds gauges read at scrape time. Called once, from the process entry point. */
export function registerRuntimeGauges({ db, pool, queues }: { db: Db; pool: pg.Pool; queues: Record<string, QueueLike> }) {
  if (runtimeGauges) return;
  runtimeGauges = true;
  new Gauge({
    name: 'stockroom_db_pool_connections',
    help: 'Database pool connections by state',
    labelNames: ['state'] as const,
    registers: [registry],
    collect() {
      this.set({ state: 'total' }, pool.totalCount);
      this.set({ state: 'idle' }, pool.idleCount);
      this.set({ state: 'waiting' }, pool.waitingCount);
    },
  });
  new Gauge({
    name: 'stockroom_outbox_unpublished_events',
    help: 'Outbox events not yet handed to their destinations. Should stay near zero.',
    registers: [registry],
    async collect() {
      const result = await db.execute<{ count: number }>(sql`select count(*)::int as count from outbox_events where published_at is null`);
      this.set(result.rows[0]?.count ?? 0);
    },
  });
  new Gauge({
    name: 'stockroom_queue_jobs',
    help: 'Background jobs by queue and state',
    labelNames: ['queue', 'state'] as const,
    registers: [registry],
    async collect() {
      for (const [name, queue] of Object.entries(queues)) {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
          for (const [state, value] of Object.entries(counts)) this.set({ queue: name, state }, value);
        } catch {
          // Redis unavailable: leave the last values rather than fail the whole scrape.
        }
      }
    },
  });
}

/**
 * GET /metrics. With METRICS_TOKEN set it needs "Authorization: Bearer <token>". Without one it's
 * open in development and switched off in production, since timings and queue sizes aren't public.
 */
export function metricsEndpoint({ token, isProduction }: { token?: string; isProduction: boolean }): RequestHandler {
  return async (req, res) => {
    if (!token && isProduction) {
      res.status(404).end();
      return;
    }
    if (token) {
      const given = Buffer.from(req.get('authorization')?.replace(/^Bearer /, '') ?? '');
      const expected = Buffer.from(token);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        res.status(401).end();
        return;
      }
    }
    res.set('Content-Type', registry.contentType).send(await registry.metrics());
  };
}
