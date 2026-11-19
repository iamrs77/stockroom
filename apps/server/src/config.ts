import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(14),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  /** all: API and worker in one process (the free tier). api / worker: run them separately to scale each. */
  ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  REDIS_URL: z.string().min(1).optional(),
  /** Prefix for every Redis key, so several environments can share one free Redis database. */
  REDIS_PREFIX: z.string().min(1).default('stockroom'),
  IMPORT_CONCURRENCY: z.coerce.number().int().positive().default(2),
  IMPORT_CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
});

export type Config = {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  sessionTtlMs: number;
  /** Sign-up and sign-in attempts allowed per IP address every 15 minutes. */
  authRateLimit: number;
  cookieSecure: boolean;
  role: 'all' | 'api' | 'worker';
  redisUrl: string;
  redisPrefix: string;
  importConcurrency: number;
  importChunkSize: number;
};

const LOCAL_DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/stockroom';
const LOCAL_REDIS_URL = 'redis://localhost:6379';

/** Loads .env from the current folder or the repo root. Variables that are already set win. */
function loadDotEnv() {
  for (const candidate of ['.env', '../../.env']) {
    const file = path.resolve(process.cwd(), candidate);
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

export function loadConfig(): Config {
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production');
  }
  if (isProduction && !env.REDIS_URL) {
    throw new Error('REDIS_URL must be set in production');
  }
  return {
    env: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL ?? LOCAL_DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
    logLevel: env.LOG_LEVEL,
    sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    authRateLimit: env.AUTH_RATE_LIMIT,
    cookieSecure: isProduction,
    role: env.ROLE,
    redisUrl: env.REDIS_URL ?? LOCAL_REDIS_URL,
    redisPrefix: env.REDIS_PREFIX,
    importConcurrency: env.IMPORT_CONCURRENCY,
    importChunkSize: env.IMPORT_CHUNK_SIZE,
  };
}
