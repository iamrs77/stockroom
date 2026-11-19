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
};

const LOCAL_DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/stockroom';

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
  };
}
