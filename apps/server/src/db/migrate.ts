import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { migrationsDir } from '../paths';
import type { Db } from './client';

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: migrationsDir() });
}
