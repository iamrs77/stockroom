import { loadConfig } from '../config';
import { createDb, waitForDatabase } from './client';
import { runMigrations } from './migrate';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl, 1);
await waitForDatabase(pool);
await runMigrations(db);
await pool.end();
console.log('Migrations applied');
