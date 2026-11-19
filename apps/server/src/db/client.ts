import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export function createDb(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
  // Hosted Postgres (e.g. Neon) closes idle connections. Without a listener that error would crash the process.
  pool.on('error', (err) => console.error('Idle database connection error', err));
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run a query: the database or an open transaction. */
export type Executor = Db | Tx;

/** Waits for Postgres to accept connections, e.g. while the local database is still starting. */
export async function waitForDatabase(pool: pg.Pool, { attempts = 30, delayMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('select 1');
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** The Postgres error inside a driver or ORM error, if there is one. */
export function pgError(err: unknown): { code: string; constraint?: string } | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const candidate = current as { code?: unknown; constraint?: string; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return { code: candidate.code, constraint: candidate.constraint };
    }
    current = candidate.cause;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';
