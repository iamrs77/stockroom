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
const badShare = Number(values.bad);
const out = path.resolve(values.out ?? `.data/imports/sample-${rows}.csv`);

let seed = 7;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]!;

const adjectives = ['Classic', 'Organic', 'Small-batch', 'Everyday', 'Premium', 'Wild', 'Toasted', 'Smoked', 'Fresh', 'Heritage'];
const nouns = ['Coffee Beans', 'Black Tea', 'Honey', 'Granola', 'Mug', 'Tote', 'Candle', 'Notebook', 'Olive Oil', 'Chocolate', 'Jam', 'Soap'];
const sizes = ['Small', 'Medium', 'Large', '250 g', '500 g', '1 kg'];
const categories = ['Pantry', 'Coffee & Tea', 'Kitchen', 'Home', 'Gifts'];

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const lines = [['sku', 'name', 'category', 'price', 'reorder_point', ...stores.map((s) => `stock:${s}`)].join(',')];
for (let i = 1; i <= rows; i++) {
  const cells = [
    `GEN-${String(i).padStart(6, '0')}`,
    `${pick(adjectives)} ${pick(nouns)}, ${pick(sizes)}`,
    pick(categories),
    (Math.floor(random() * 6000 + 199) / 100).toFixed(2),
    String(Math.floor(random() * 20)),
    ...stores.map(() => String(Math.floor(random() * 120))),
  ];
  if (random() < badShare) {
    // A few typical mistakes: a word where a price goes, a negative count, a missing SKU.
    const mistake = Math.floor(random() * 3);
    if (mistake === 0) cells[3] = 'TBD';
    else if (mistake === 1 && stores.length) cells[5] = '-3';
    else cells[0] = '';
  }
  lines.push(cells.map(csvCell).join(','));
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote ${rows.toLocaleString('en-CA')} rows for stores ${stores.join(', ')} to ${path.relative(process.cwd(), out)}`);
