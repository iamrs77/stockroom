import type { Server } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb, waitForDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { createLogger } from './logger';
import { ImportEvents } from './modules/imports/events';
import { createImportQueue, startImportWorker } from './modules/imports/queue';
import { webDistDir } from './paths';
import { createRedis } from './redis';

const config = loadConfig();
const logger = createLogger(config);
const { db, pool } = createDb(config.databaseUrl, config.databasePoolMax);

await waitForDatabase(pool);
// Migrations run on start-up: free hosts have no separate release step, and there's one instance.
await runMigrations(db);

// ROLE decides what this process runs: the HTTP API, the import worker, or both (the free tier).
// Every role needs a connection for queueing and publishing; the API also subscribes to progress.
const runsApi = config.role !== 'worker';
const runsWorker = config.role !== 'api';
const redis = createRedis(config.redisUrl, 'commands', logger);
const subscriber = runsApi ? createRedis(config.redisUrl, 'subscriber', logger) : undefined;
const events = new ImportEvents({ prefix: config.redisPrefix, logger, publisher: redis, subscriber });
const importQueue = createImportQueue({ connection: redis, prefix: config.redisPrefix, logger });

let server: Server | undefined;
if (runsApi) {
  const app = createApp({
    config,
    db,
    pool,
    logger,
    imports: { queue: importQueue, events },
    webDir: config.isProduction ? webDistDir() : undefined,
  });
  server = app.listen(config.port, () => logger.info(`Server listening on http://localhost:${config.port}`));
}

const worker = runsWorker
  ? startImportWorker({
      db,
      redisUrl: config.redisUrl,
      prefix: config.redisPrefix,
      logger,
      events,
      importQueue,
      concurrency: config.importConcurrency,
      chunkSize: config.importChunkSize,
    })
  : undefined;
if (worker) logger.info({ concurrency: config.importConcurrency }, 'Import worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref();

  // Stop taking requests and give in-flight ones a few seconds to finish. Event streams never
  // finish on their own, so whatever is still open after that is closed (browsers reconnect).
  const serverClosed = server
    ? new Promise<void>((resolve) => server.close(() => resolve()))
    : Promise.resolve();
  server?.closeIdleConnections();
  setTimeout(() => server?.closeAllConnections(), 5000).unref();
  // The worker finishes its current chunk and hands the rest of the import back to the queue.
  await worker?.close();
  await serverClosed;
  await importQueue.close();
  subscriber?.disconnect();
  redis.disconnect();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
