import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port'))));
    });
  });
}

/**
 * Starts a throwaway Postgres for the test run, unless TEST_DATABASE_URL points at one already.
 * Each test signs up its own business, so tests never see each other's data and need no cleanup.
 */
export default async function setup(project: TestProject) {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let stop = async () => {};

  if (!databaseUrl) {
    const port = await freePort();
    const pg = new EmbeddedPostgres({
      databaseDir: await mkdtemp(path.join(os.tmpdir(), 'stockroom-test-pg-')),
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
      onLog: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('stockroom_test');
    databaseUrl = `postgres://postgres:postgres@localhost:${port}/stockroom_test`;
    stop = () => pg.stop();
  }

  const { db, pool } = createDb(databaseUrl, 1);
  await runMigrations(db);
  await pool.end();

  project.provide('databaseUrl', databaseUrl);
  return stop;
}
