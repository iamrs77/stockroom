import { pino, type Logger } from 'pino';
import type { Config } from './config';

export type { Logger };

export function createLogger(config: Pick<Config, 'logLevel' | 'isProduction'>): Logger {
  return pino({
    level: config.logLevel,
    redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
    // Readable logs in development, JSON lines in production.
    transport: config.isProduction
      ? undefined
      : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  });
}
