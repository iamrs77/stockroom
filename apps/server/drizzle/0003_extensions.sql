-- Trigram indexes make substring search (ILIKE '%term%') use an index instead of reading every row.
-- Available on Neon, Supabase and the embedded Postgres used for development and tests.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
