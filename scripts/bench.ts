/**
 * Load-tests the API against a business with many products, and prints a Markdown table.
 *
 *   npm run bench -- --url http://localhost:3100 --label before
 *   npm run bench -- --url http://localhost:3100 --label after --compare before
 *
 * The first run creates a "Bench" business with three stores and loads --products rows through the
 * real import pipeline. Each scenario then runs for --duration seconds with --connections concurrent
 * connections, after a short warm-up. Results are saved to .data/bench/<label>.json so runs can be
 * compared.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import autocannon from 'autocannon';
import { sampleImportCsv } from './lib/sample-data';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3100' },
    products: { type: 'string', default: '100000' },
    duration: { type: 'string', default: '10' },
    connections: { type: 'string', default: '10' },
    label: { type: 'string', default: 'run' },
    compare: { type: 'string' },
    only: { type: 'string' },
  },
});

const base = values.url!.replace(/\/$/, '');
const EMAIL = 'bench@stockroom.local';
const PASSWORD = 'bench-password-123';
const STORES = ['QSW', 'KEN', 'WH'];
let cookie = '';

async function call<T>(method: string, route: string, body?: unknown, raw?: string): Promise<{ status: number; data: T }> {
  const res = await fetch(`${base}/api${route}`, {
    method,
    headers: {
      ...(cookie && { cookie }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(raw !== undefined && { 'content-type': 'text/csv' }),
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}

async function prepare() {
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) {
    const reg = await call('POST', '/auth/register', { businessName: 'Bench', name: 'Bench', email: EMAIL, password: PASSWORD });
    if (reg.status !== 201) throw new Error(`Could not create the bench account: ${JSON.stringify(reg.data)}`);
  }
  const stores = (await call<{ items: { id: string; code: string }[] }>('GET', '/stores')).data.items;
  for (const code of STORES.filter((c) => !stores.some((s) => s.code === c))) {
    await call('POST', '/stores', { name: `Store ${code}`, code });
  }
  const storeIds = (await call<{ items: { id: string; code: string }[] }>('GET', '/stores')).data.items.map((s) => s.id);

  const wanted = Number(values.products);
  const { total } = (await call<{ total: number }>('GET', '/products?pageSize=1')).data;
  if (total < wanted) {
    console.log(`Loading ${wanted.toLocaleString('en-CA')} products through the import pipeline…`);
    const csv = sampleImportCsv({ rows: wanted, stores: STORES, seed: 11 });
    const upload = await call<{ import: { id: string } }>('POST', `/imports?fileName=bench-${wanted}.csv`, undefined, csv);
    const id = upload.data.import.id;
    for (;;) {
      const { data } = await call<{ status: string; processedRows: number; totalRows: number }>('GET', `/imports/${id}`);
      if (data.status === 'completed') break;
      if (data.status === 'failed') throw new Error('The bench import failed');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  // Products to read and write at random during the run.
  const ids: string[] = [];
  for (const page of [1, 50, 400, 1000, 2000, 3500]) {
    const res = await call<{ items: { id: string }[] }>('GET', `/products?sort=sku&pageSize=100&page=${page}`);
    ids.push(...res.data.items.map((p) => p.id));
  }
  // A cursor 2,000 pages in, if this build pages by cursor.
  const deep = await call<{ nextCursor?: string | null }>('GET', '/products?sort=name&page=2000');
  return { storeIds, ids, deepCursor: deep.data.nextCursor ?? undefined };
}

type Scenario = {
  name: string;
  method?: 'GET' | 'POST';
  path: string | (() => string);
  body?: () => string;
};

type Result = { name: string; rps: number; p50: number; p90: number; p99: number; errors: number };

const pickOne = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]!;

async function run(scenario: Scenario, duration: number, connections: number): Promise<Result> {
  const options = {
    url: base,
    connections,
    duration,
    headers: { cookie, 'content-type': 'application/json' },
    requests: [
      {
        method: scenario.method ?? 'GET',
        setupRequest: (req: autocannon.Request) => ({
          ...req,
          path: typeof scenario.path === 'function' ? scenario.path() : scenario.path,
          ...(scenario.body && { body: scenario.body() }),
        }),
      },
    ],
  };
  await autocannon({ ...options, duration: 2 }); // warm-up, discarded
  const r = await autocannon(options);
  return {
    name: scenario.name,
    rps: Math.round(r.requests.average),
    p50: r.latency.p50,
    p90: r.latency.p90,
    p99: r.latency.p99,
    errors: r.errors + r.timeouts + r.non2xx,
  };
}

const { storeIds, ids, deepCursor } = await prepare();
const allScenarios: Scenario[] = [
  { name: 'List, first page', path: '/api/products?sort=name' },
  { name: 'List, page 2,000', path: '/api/products?sort=name&page=2000' },
  ...(deepCursor ? [{ name: 'List, page 2,001 by cursor', path: `/api/products?sort=name&after=${deepCursor}` }] : []),
  { name: 'Sort by stock', path: '/api/products?sort=stock&dir=desc' },
  { name: 'Low-stock filter', path: '/api/products?lowStock=true' },
  { name: 'Search "honey"', path: '/api/products?q=honey' },
  { name: 'Search a SKU', path: () => `/api/products?q=GEN-0${String(10000 + Math.floor(Math.random() * 89999))}` },
  { name: 'Product detail', path: () => `/api/products/${pickOne(ids)}` },
  {
    name: 'Stock change (write)',
    method: 'POST',
    path: () => `/api/products/${pickOne(ids)}/stock-adjustments`,
    body: () => JSON.stringify({ storeId: pickOne(storeIds), delta: 1, reason: 'received' }),
  },
];
const scenarios = allScenarios.filter((s) => !values.only || s.name.toLowerCase().includes(values.only.toLowerCase()));

const duration = Number(values.duration);
const connections = Number(values.connections);
console.log(`Running ${scenarios.length} scenarios, ${duration} s each, ${connections} connections, against ${base}\n`);
const results: Result[] = [];
for (const scenario of scenarios) {
  const result = await run(scenario, duration, connections);
  results.push(result);
  console.log(`  ${scenario.name}: ${result.rps} req/s, p50 ${result.p50} ms, p99 ${result.p99} ms${result.errors ? `, ${result.errors} errors` : ''}`);
}

const dir = path.resolve('.data/bench');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${values.label}.json`), JSON.stringify({ at: new Date().toISOString(), duration, connections, results }, null, 2));

const before: Result[] | undefined =
  values.compare && existsSync(path.join(dir, `${values.compare}.json`))
    ? JSON.parse(readFileSync(path.join(dir, `${values.compare}.json`), 'utf8')).results
    : undefined;

console.log(`\n| Scenario | req/s | p50 | p90 | p99 |${before ? ` p50 before | change |` : ''}`);
console.log(`|---|--:|--:|--:|--:|${before ? '--:|--:|' : ''}`);
for (const r of results) {
  const b = before?.find((x) => x.name === r.name);
  const change = b ? `${b.p50 / Math.max(r.p50, 0.1) >= 1 ? `${(b.p50 / Math.max(r.p50, 0.1)).toFixed(1)}× faster` : `${(r.p50 / b.p50).toFixed(1)}× slower`}` : '';
  console.log(`| ${r.name} | ${r.rps} | ${r.p50} ms | ${r.p90} ms | ${r.p99} ms |${before ? ` ${b ? `${b.p50} ms` : '—'} | ${change} |` : ''}${r.errors ? ` (${r.errors} errors)` : ''}`);
}
