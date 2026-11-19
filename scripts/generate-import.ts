/**
 * Writes a large, realistic import file for demos and load testing.
 *
 *   npm run sample:import -- --rows 100000 --stores QSW,KEN,WH --bad 0.002
 *
 * The demo business's store codes are QSW, KEN and WH. --bad mixes in that share of broken rows,
 * so the problem report has something to show. The output is the same for the same arguments.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sampleImportCsv } from './lib/sample-data';

const { values } = parseArgs({
  options: {
    rows: { type: 'string', default: '100000' },
    stores: { type: 'string', default: 'QSW,KEN,WH' },
    bad: { type: 'string', default: '0.002' },
    out: { type: 'string' },
  },
});

const rows = Number(values.rows);
const stores = values.stores!.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const out = path.resolve(values.out ?? `.data/imports/sample-${rows}.csv`);

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, sampleImportCsv({ rows, stores, bad: Number(values.bad) }));
console.log(`Wrote ${rows.toLocaleString('en-CA')} rows for stores ${stores.join(', ')} to ${path.relative(process.cwd(), out)}`);
