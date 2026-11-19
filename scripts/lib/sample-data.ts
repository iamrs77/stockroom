/** Deterministic sample import files: the same options always produce the same file. */

const adjectives = ['Classic', 'Organic', 'Small-batch', 'Everyday', 'Premium', 'Wild', 'Toasted', 'Smoked', 'Fresh', 'Heritage'];
const nouns = ['Coffee Beans', 'Black Tea', 'Honey', 'Granola', 'Mug', 'Tote', 'Candle', 'Notebook', 'Olive Oil', 'Chocolate', 'Jam', 'Soap'];
const sizes = ['Small', 'Medium', 'Large', '250 g', '500 g', '1 kg'];
const categories = ['Pantry', 'Coffee & Tea', 'Kitchen', 'Home', 'Gifts'];

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export type SampleOptions = {
  rows: number;
  /** Store codes, one stock column each. */
  stores: string[];
  /** Share of rows (0 to 1) given a typical mistake, so the problem report has something to show. */
  bad?: number;
  seed?: number;
};

export function sampleImportCsv({ rows, stores, bad = 0, seed = 7 }: SampleOptions): string {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;

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
    if (random() < bad) {
      // A few typical mistakes: a word where a price goes, a negative count, a missing SKU.
      const mistake = Math.floor(random() * 3);
      if (mistake === 0) cells[3] = 'TBD';
      else if (mistake === 1 && stores.length) cells[5] = '-3';
      else cells[0] = '';
    }
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
