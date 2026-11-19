import { DelayedError, Queue, Worker } from 'bullmq';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Db } from '@/db/client';
import { imports } from '@/db/schema';
import type { Logger } from '@/logger';
import { createRedis, withTimeout } from '@/redis';
import type { ImportEvents } from './events';
import { failImport, processImport } from './process';
import { getImportSummary } from './service';

export const IMPORT_QUEUE = 'imports';
type JobData = { importId: string };

const ATTEMPTS = 5;

export type ImportQueue = {
  /**
   * Hands an import to the workers. Never throws: the import is already safe in Postgres, and if
   * Redis is unavailable the sweeper queues it once Redis is back.
   */
  enqueue(importId: string): Promise<boolean>;
  close(): Promise<void>;
  queue: Queue<JobData>;
};

export function createImportQueue({ connection, prefix, logger }: { connection: Redis; prefix: string; logger: Logger }): ImportQueue {
  const queue = new Queue<JobData>(IMPORT_QUEUE, {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: ATTEMPTS,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return {
    queue,
    async enqueue(importId) {
      try {
        // The job id is the import id, so adding the same import twice is a no-op.
        await withTimeout(queue.add('import', { importId }, { jobId: importId }), 3000, 'Queueing the import');
        return true;
      } catch (err) {
        logger.warn({ err: (err as Error).message, importId }, 'Could not queue the import; the sweeper will retry');
        return false;
      }
    },
    close: () => queue.close(),
  };
}

export type ImportWorkerOptions = {
  db: Db;
  redisUrl: string;
  prefix: string;
  logger: Logger;
  events: ImportEvents;
  importQueue: ImportQueue;
  concurrency: number;
  chunkSize: number;
  /** Tells the outbox relay about events committed by an import (alerts, completion). */
  pokeOutbox?: () => void;
  maxRows?: number;
  demoMaxRows?: number;
  /** BullMQ polling: raise these on Redis plans that count commands. */
  drainDelaySeconds?: number;
  stalledIntervalMs?: number;
  /** How often to look for imports the queue lost, and how old they must be. */
  sweepEveryMs?: number;
  staleAfterMs?: number;
};

export function startImportWorker(options: ImportWorkerOptions) {
  const { db, logger, events, importQueue } = options;
  const stopping = new AbortController();
  const connection = createRedis(options.redisUrl, 'import-worker', logger);

  const worker = new Worker<JobData>(
    IMPORT_QUEUE,
    async (job, token) => {
      const outcome = await processImport(db, job.data.importId, {
        chunkSize: options.chunkSize,
        logger,
        signal: stopping.signal,
        publish: (summary) => events.publish(summary),
        pokeOutbox: options.pokeOutbox,
        maxRows: options.maxRows,
        demoMaxRows: options.demoMaxRows,
      });
      if (outcome === 'busy' || outcome === 'stopped') {
        // Put the job back without using up an attempt: "busy" waits for this business's other
        // import to finish; "stopped" lets another worker (or this one, restarted) resume it.
        await job.moveToDelayed(Date.now() + (outcome === 'busy' ? 3000 : 500), token);
        throw new DelayedError();
      }
      return { outcome };
    },
    {
      connection,
      prefix: options.prefix,
      concurrency: options.concurrency,
      // A free instance can be paused or restarted mid-import. Work resumes from the checkpoint, so allow a few stalls.
      maxStalledCount: 3,
      drainDelay: options.drainDelaySeconds ?? 5,
      stalledInterval: options.stalledIntervalMs ?? 30_000,
    },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    logger.error({ err, importId: job.data.importId, attempt: job.attemptsMade }, 'Import attempt failed');
    void (async () => {
      try {
        // Only act when BullMQ has given up (out of retries, or stalled too often); otherwise it retries.
        if ((await job.getState()) !== 'failed') return;
        // Record it, so the import doesn't sit in "processing" forever.
        await failImport(db, job.data.importId, 'The import kept failing because of a server problem. Try uploading the file again.');
        options.pokeOutbox?.();
        const [row] = await db.select({ tenantId: imports.tenantId }).from(imports).where(eq(imports.id, job.data.importId));
        if (row) await events.publish(await getImportSummary(db, row.tenantId, job.data.importId));
      } catch (failErr) {
        logger.error({ err: failErr }, 'Could not mark the import failed');
      }
    })();
  });
  worker.on('error', (err) => logger.warn({ err: err.message }, 'Import worker error'));

  /**
   * Postgres is the source of truth and the queue only delivers work, so this repairs the gap
   * between them. Any unfinished import that hasn't moved for a while is queued again: a no-op if
   * its job still exists, a rescue if the job was lost (Redis restarted, or queueing failed).
   */
  const staleAfterMs = options.staleAfterMs ?? 2 * 60_000;
  const sweep = async () => {
    try {
      const stale = await db
        .select({ id: imports.id })
        .from(imports)
        .where(
          and(
            inArray(imports.status, ['queued', 'processing']),
            lt(imports.updatedAt, new Date(Date.now() - staleAfterMs)),
          ),
        )
        .limit(100);
      for (const { id } of stale) await importQueue.enqueue(id);
      if (stale.length) logger.info({ count: stale.length }, 'Sweeper re-queued unfinished imports');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Import sweep failed');
    }
  };
  const sweeper = setInterval(sweep, options.sweepEveryMs ?? 60_000);
  sweeper.unref();
  void sweep();

  return {
    worker,
    sweep,
    /** Finishes the current chunk, hands unfinished imports back to the queue, then disconnects. */
    async close() {
      clearInterval(sweeper);
      stopping.abort();
      await worker.close();
      connection.disconnect();
    },
  };
}
