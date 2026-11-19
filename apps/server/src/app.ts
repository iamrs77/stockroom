import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config';
import type { createDb, Db } from './db/client';
import { requireAuth } from './http/auth';
import { errorHandler, notFoundHandler } from './http/errors';
import type { Logger } from './logger';
import { authRouter } from './modules/auth/routes';
import { productsRouter } from './modules/products/routes';
import { storesRouter } from './modules/stores/routes';

export type AppDeps = {
  config: Config;
  db: Db;
  pool: ReturnType<typeof createDb>['pool'];
  logger: Logger;
  /** Folder of the built web app to serve, if any. */
  webDir?: string;
};

export function createApp(deps: AppDeps) {
  const { config, pool, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  // Free hosts put the app behind one proxy; trusting it gives the real client IP for rate limits.
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'];
        const requestId = typeof id === 'string' && id.length <= 100 ? id : randomUUID();
        res.setHeader('X-Request-Id', requestId);
        return requestId;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();

  // Liveness: the process is up. Readiness: it can reach the database.
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  api.get('/ready', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  api.use('/auth', authRouter(deps));
  api.use(requireAuth(deps));
  api.use('/stores', storesRouter(deps));
  api.use('/products', productsRouter(deps));
  api.use(notFoundHandler);

  app.use('/api', api);

  if (deps.webDir && existsSync(path.join(deps.webDir, 'index.html'))) {
    const indexHtml = path.join(deps.webDir, 'index.html');
    // Built asset names contain a content hash, so they can be cached forever.
    app.use('/assets', express.static(path.join(deps.webDir, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(deps.webDir, { index: false }));
    // Every other page is handled by the web app's router.
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
