/**
 * Runs a real PostgreSQL server for local development, without Docker or an installer.
 * Data is kept in .data/postgres, so it survives restarts. Stop it with Ctrl+C.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.PGPORT ?? 5433);
const dataDir = path.resolve(import.meta.dirname, '../.data/postgres');
const databases = ['stockroom'];

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => {},
  onError: (message) => console.error(String(message)),
});

if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
  console.log('First run: creating a database cluster in .data/postgres');
  await pg.initialise();
}

await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const name of databases) {
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (!rowCount) {
    await client.query(`create database "${name}"`);
    console.log(`Created database "${name}"`);
  }
}
await client.end();

console.log(`Postgres is ready at postgres://postgres:postgres@localhost:${port}/stockroom (Ctrl+C to stop)`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Keep the process alive while Postgres runs.
setInterval(() => {}, 1 << 30);
