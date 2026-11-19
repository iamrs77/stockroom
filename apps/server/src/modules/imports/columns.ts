import { skuSchema } from '@stockroom/shared';
import { ImportFileError, type SheetRow } from './read-rows';

/**
 * File format: one row per product.
 *
 *   sku, name, category, price, reorder_point, stock:QSW, stock:KEN, ...
 *
 * Only sku is required. An empty cell leaves that value unchanged. A stock:<store code> cell is the
 * counted quantity in that store: the import sets stock to it and records the difference in the
 * ledger. Because counts are absolute, applying the same row twice changes nothing the second time.
 */
type Field = 'sku' | 'name' | 'category' | 'price' | 'reorderPoint';

const FIELD_NAMES: Record<string, Field> = {
  sku: 'sku',
  name: 'name',
  'product name': 'name',
  category: 'category',
  price: 'price',
  'reorder point': 'reorderPoint',
};

const STOCK_COLUMN = /^stock\s*[:_\s-]\s*(.+)$/i;

export type ColumnMap = {
  fields: Partial<Record<Field, number>> & { sku: number };
  stock: { index: number; storeId: string; code: string }[];
  /** Header text by column index, for error messages. */
  headers: string[];
};

export type ImportRow = {
  rowNumber: number;
  sku: string;
  name?: string;
  category?: string;
  priceCents?: number;
  reorderPoint?: number;
  stock: { storeId: string; quantity: number }[];
};

export type RowError = { rowNumber: number; sku: string | null; column: string | null; message: string };

const normalise = (header: string) => header.trim().toLowerCase().replace(/[\s_]+/g, ' ');

export function mapColumns(header: SheetRow, stores: { id: string; code: string }[]): ColumnMap {
  const fields: Partial<Record<Field, number>> = {};
  const stock: ColumnMap['stock'] = [];
  const seen = new Set<string>();
  const storesByCode = new Map(stores.map((s) => [s.code.toUpperCase(), s]));

  header.cells.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    const key = normalise(text);
    if (seen.has(key)) throw new ImportFileError(`The column "${text}" appears twice.`);
    seen.add(key);

    const stockMatch = STOCK_COLUMN.exec(text);
    if (stockMatch) {
      const code = stockMatch[1]!.trim().toUpperCase();
      const store = storesByCode.get(code);
      if (!store) {
        const known = stores.map((s) => s.code).join(', ');
        throw new ImportFileError(`The column "${text}" names a store code you don't have. Your stores: ${known}.`);
      }
      stock.push({ index, storeId: store.id, code });
      return;
    }

    const field = FIELD_NAMES[key];
    if (!field) {
      throw new ImportFileError(
        `Unknown column "${text}". Use sku, name, category, price, reorder_point, or stock:<store code>.`,
      );
    }
    fields[field] = index;
  });

  if (fields.sku === undefined) {
    throw new ImportFileError('The first row must be a header with a "sku" column.');
  }
  if (Object.keys(fields).length === 1 && stock.length === 0) {
    throw new ImportFileError('Add at least one column to import besides sku, such as price or stock:<store code>.');
  }
  return { fields: { ...fields, sku: fields.sku }, stock, headers: header.cells };
}

function parsePrice(text: string): number | string {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return 'Use a number like 12.50';
  const value = Number(cleaned);
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return 'Use at most 2 decimal places';
  if (cents > 100_000_000) return 'Price is too large';
  return cents;
}

function parseCount(text: string, max = 1_000_000): number | string {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return 'Use a whole number, 0 or more';
  const value = Number(cleaned);
  if (value > max) return `Use a number no larger than ${max.toLocaleString('en-CA')}`;
  return value;
}

/**
 * Validates one data row. A row with any problem is skipped as a whole, so a half-applied row
 * (say, a new price but not its stock) can't happen.
 */
export function parseRow(row: SheetRow, map: ColumnMap): { row: ImportRow } | { errors: RowError[]; sku: string | null } {
  const cell = (index: number | undefined) => (index === undefined ? '' : (row.cells[index] ?? '').trim());
  const errors: RowError[] = [];
  const rawSku = cell(map.fields.sku);
  const fail = (column: number | undefined, message: string) =>
    errors.push({
      rowNumber: row.rowNumber,
      sku: rawSku || null,
      column: column === undefined ? null : (map.headers[column] ?? null),
      message,
    });

  const sku = skuSchema.safeParse(rawSku);
  if (!sku.success) fail(map.fields.sku, rawSku ? sku.error.issues[0]!.message : 'SKU is missing');

  const result: ImportRow = { rowNumber: row.rowNumber, sku: sku.success ? sku.data : '', stock: [] };

  const name = cell(map.fields.name);
  if (name) {
    if (name.length > 200) fail(map.fields.name, 'Use at most 200 characters');
    else result.name = name;
  }
  const category = cell(map.fields.category);
  if (category) {
    if (category.length > 100) fail(map.fields.category, 'Use at most 100 characters');
    else result.category = category;
  }
  const price = cell(map.fields.price);
  if (price) {
    const parsed = parsePrice(price);
    if (typeof parsed === 'string') fail(map.fields.price, parsed);
    else result.priceCents = parsed;
  }
  const reorderPoint = cell(map.fields.reorderPoint);
  if (reorderPoint) {
    const parsed = parseCount(reorderPoint);
    if (typeof parsed === 'string') fail(map.fields.reorderPoint, parsed);
    else result.reorderPoint = parsed;
  }
  for (const column of map.stock) {
    const text = cell(column.index);
    if (!text) continue;
    const parsed = parseCount(text);
    if (typeof parsed === 'string') fail(column.index, parsed);
    else result.stock.push({ storeId: column.storeId, quantity: parsed });
  }

  return errors.length ? { errors, sku: rawSku || null } : { row: result };
}
