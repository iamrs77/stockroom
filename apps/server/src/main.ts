import { createApp } from './app';
import { loadConfig } from './config';
import { createDb, waitForDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { createLogger } from './logger';
import { webDistDir } from './paths';

const config = loadConfig();
const logger = createLogger(config);
const { db, pool } = createDb(config.databaseUrl, config.databasePoolMax);

await waitForDatabase(pool);
// Migrations run on start-up: free hosts have no separate release step, and there's one instance.
await runMigrations(db);

const app = createApp({ config, db, pool, logger, webDir: config.isProduction ? webDistDir() : undefined });
const server = app.listen(config.port, () => {
  logger.info(`Server listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  // Stop taking new connections, let in-flight requests finish, then close the database pool.
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
