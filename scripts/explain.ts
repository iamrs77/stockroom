/**
 * Prints query plans (EXPLAIN ANALYZE) for the product list's main queries against the bench
 * business, so performance changes can be explained rather than guessed at.
 *
 *   npm run explain                 # uses the local development database
 *   DATABASE_URL=... npm run explain
 */
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/stockroom';
const client = new pg.Client(url);
await client.connect();

const tenant = await client.query<{ tenant_id: string }>(`select tenant_id from users where email = 'bench@stockroom.local'`);
const tenantId = tenant.rows[0]?.tenant_id;
if (!tenantId) throw new Error('No bench business yet: run npm run bench first');

const queries: [string, string][] = [
  [
    'First page, by name',
    `select id from products where tenant_id = $1 and archived_at is null order by name, id limit 26`,
  ],
  [
    'Count for the page total (stops at 10,001)',
    `select count(*) from (select 1 from products where tenant_id = $1 and archived_at is null limit 10001) capped`,
  ],
  [
    'Sorted by stock',
    `select id from products where tenant_id = $1 and archived_at is null order by total_stock desc, id desc limit 26`,
  ],
  [
    'Low-stock filter',
    `select id from products where tenant_id = $1 and archived_at is null and low_stock order by name, id limit 26`,
  ],
  [
    'Count for the low-stock total',
    `select count(*) from (select 1 from products where tenant_id = $1 and archived_at is null and low_stock limit 10001) capped`,
  ],
  [
    'Search for a SKU',
    `select id from products where tenant_id = $1 and archived_at is null and search_text like '%gen-050000%' order by name, id limit 26`,
  ],
];

for (const [title, text] of queries) {
  const plan = await client.query<{ 'QUERY PLAN': string }>(`explain (analyze, buffers, costs off, summary on) ${text}`, [tenantId]);
  console.log(`\n## ${title}\n`);
  console.log(plan.rows.map((r) => r['QUERY PLAN']).join('\n'));
}
await client.end();
