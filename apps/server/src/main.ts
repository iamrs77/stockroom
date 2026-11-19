import type { Server } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb, waitForDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { createLogger } from './logger';
import { registerRuntimeGauges } from './metrics';
import { createOutboxPoke, startOutboxRelay } from './modules/events/relay';
import { ImportEvents } from './modules/imports/events';
import { createImportQueue, startImportWorker } from './modules/imports/queue';
import { startJanitor } from './modules/maintenance/janitor';
import { createWebhookQueue, startWebhookWorker } from './modules/webhooks/delivery';
import { webDistDir } from './paths';
import { createRedis } from './redis';

const config = loadConfig();
const logger = createLogger(config);
const { db, pool } = createDb(config.databaseUrl, config.databasePoolMax);

await waitForDatabase(pool);
// Migrations run on start-up: free hosts have no separate release step, and there's one instance.
await runMigrations(db);

// ROLE decides what this process runs: the HTTP API, the background workers, or both (the free tier).
const runsApi = config.role !== 'worker';
const runsWorker = config.role !== 'api';
const prefix = config.redisPrefix;

const redis = createRedis(config.redisUrl, 'commands', logger);
const subscriber = createRedis(config.redisUrl, 'subscriber', logger);
const events = new ImportEvents({ prefix, logger, publisher: redis, subscriber: runsApi ? subscriber : undefined });
const importQueue = createImportQueue({ connection: redis, prefix, logger });
const webhookQueue = createWebhookQueue({ connection: redis, prefix, logger, retryDelayMs: config.webhookRetryDelayMs });

// Background work: imports, the outbox relay, webhook deliveries and clean-up.
const relay = runsWorker ? startOutboxRelay({ db, logger, webhookQueue, pollEveryMs: config.outboxPollMs }) : undefined;
const outbox = createOutboxPoke({ prefix, publisher: redis, localDrain: relay?.drain });
if (relay && !runsApi) {
  // A worker on its own hears about new events from the API processes over Redis.
  subscriber.subscribe(outbox.channel).catch((err: Error) => logger.warn({ err: err.message }, 'Could not subscribe to outbox pokes'));
  subscriber.on('message', (channel) => channel === outbox.channel && void relay.drain());
}
const importWorker = runsWorker
  ? startImportWorker({
      db,
      redisUrl: config.redisUrl,
      prefix,
      logger,
      events,
      importQueue,
      concurrency: config.importConcurrency,
      chunkSize: config.importChunkSize,
      pokeOutbox: outbox.poke,
    })
  : undefined;
const webhookWorker = runsWorker
  ? startWebhookWorker({
      db,
      redisUrl: config.redisUrl,
      prefix,
      logger,
      webhookQueue,
      allowPrivate: config.webhooksAllowPrivate,
      timeoutMs: config.webhookTimeoutMs,
    })
  : undefined;
const janitor = runsWorker ? startJanitor({ db, logger }) : undefined;
registerRuntimeGauges({ db, pool, queues: { imports: importQueue.queue, webhooks: webhookQueue.queue } });
if (runsWorker) logger.info({ importConcurrency: config.importConcurrency }, 'Background workers started');

let server: Server | undefined;
if (runsApi) {
  const app = createApp({
    config,
    db,
    pool,
    logger,
    imports: { queue: importQueue, events },
    outbox,
    webDir: config.isProduction ? webDistDir() : undefined,
  });
  server = app.listen(config.port, () => logger.info(`Server listening on http://localhost:${config.port}`));
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref();

  // Stop taking requests and give in-flight ones a few seconds to finish. Event streams never
  // finish on their own, so whatever is still open after that is closed (browsers reconnect).
  const serverClosed = server ? new Promise<void>((resolve) => server.close(() => resolve())) : Promise.resolve();
  server?.closeIdleConnections();
  setTimeout(() => server?.closeAllConnections(), 5000).unref();
  // The import worker finishes its current chunk and hands the rest back to the queue.
  janitor?.close();
  await Promise.all([importWorker?.close(), webhookWorker?.close(), relay?.close()]);
  await serverClosed;
  await Promise.all([importQueue.close(), webhookQueue.close()]);
  subscriber.disconnect();
  redis.disconnect();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
