import { defineConfig } from 'drizzle-kit';

// Only `drizzle-kit generate` uses this, and it reads the schema without connecting to a database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
