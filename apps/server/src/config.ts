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
  /** Lets webhooks reach localhost and private networks. Never in production; defaults on in development. */
  WEBHOOKS_ALLOW_PRIVATE: z.stringbool().optional(),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WEBHOOK_RETRY_DELAY_MS: z.coerce.number().int().positive().default(10_000),
  /** How often the outbox relay checks for events it wasn't told about (it's normally poked). */
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(30_000),
  /** Bearer token for GET /metrics. Without it the endpoint is off in production. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Whether anyone can create a business. A public demo can turn this off and offer sandboxes only. */
  SIGNUPS_ENABLED: z.stringbool().default(true),
  /** "Try the demo": a private sandbox business per visitor, deleted after DEMO_TTL_HOURS. */
  DEMO_ENABLED: z.stringbool().default(true),
  DEMO_TTL_HOURS: z.coerce.number().positive().default(24),
  /** Sandboxes that can exist at once, so a free database can't fill up. */
  DEMO_MAX_ACTIVE: z.coerce.number().int().positive().default(100),
  /** Sandboxes one IP address can create per hour. */
  DEMO_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().max(100_000).default(100_000),
  DEMO_IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(2_000),
  /**
   * How long an idle queue worker blocks on Redis before asking again, and how often it checks for
   * stalled jobs. Hosted Redis plans that count commands (Upstash free: 500,000 a month) need these
   * raised: see docs/deploy.md.
   */
  QUEUE_DRAIN_DELAY_SECONDS: z.coerce.number().int().positive().default(5),
  QUEUE_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * How often the safety nets run (re-queueing lost imports and webhooks, deleting expired demos).
   * Unset: every 1 to 10 minutes. On a database that sleeps when idle (Neon free), set it to 30
   * minutes so an idle app lets the database sleep: see docs/deploy.md.
   */
  SWEEP_INTERVAL_MS: z.coerce.number().int().positive().optional(),
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
  webhooksAllowPrivate: boolean;
  webhookTimeoutMs: number;
  webhookRetryDelayMs: number;
  outboxPollMs: number;
  metricsToken?: string;
  signupsEnabled: boolean;
  demo: { enabled: boolean; ttlMs: number; maxActive: number; rateLimit: number };
  importMaxRows: number;
  demoImportMaxRows: number;
  queue: { drainDelaySeconds: number; stalledIntervalMs: number };
  sweepIntervalMs?: number;
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
  if (isProduction && env.WEBHOOKS_ALLOW_PRIVATE) {
    throw new Error('WEBHOOKS_ALLOW_PRIVATE must not be set in production');
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
    webhooksAllowPrivate: env.WEBHOOKS_ALLOW_PRIVATE === undefined ? env.NODE_ENV === 'development' : env.WEBHOOKS_ALLOW_PRIVATE,
    webhookTimeoutMs: env.WEBHOOK_TIMEOUT_MS,
    webhookRetryDelayMs: env.WEBHOOK_RETRY_DELAY_MS,
    outboxPollMs: env.OUTBOX_POLL_MS,
    metricsToken: env.METRICS_TOKEN,
    signupsEnabled: env.SIGNUPS_ENABLED,
    demo: {
      enabled: env.DEMO_ENABLED,
      ttlMs: env.DEMO_TTL_HOURS * 60 * 60 * 1000,
      maxActive: env.DEMO_MAX_ACTIVE,
      rateLimit: env.DEMO_RATE_LIMIT,
    },
    importMaxRows: env.IMPORT_MAX_ROWS,
    demoImportMaxRows: env.DEMO_IMPORT_MAX_ROWS,
    queue: { drainDelaySeconds: env.QUEUE_DRAIN_DELAY_SECONDS, stalledIntervalMs: env.QUEUE_STALLED_INTERVAL_MS },
    sweepIntervalMs: env.SWEEP_INTERVAL_MS,
  };
}
