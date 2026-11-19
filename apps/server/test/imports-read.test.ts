import writeXlsxFile from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';
import { mapColumns, parseRow } from '@/modules/imports/columns';
import { detectFormat, ImportFileError, readRows, type SheetRow } from '@/modules/imports/read-rows';

const stores = [
  { id: 'store-qsw', code: 'QSW' },
  { id: 'store-wh', code: 'WH' },
];

async function rowsOf(content: Buffer) {
  const rows: SheetRow[] = [];
  for await (const row of readRows(content, detectFormat(content))) rows.push(row);
  return rows;
}

const header = (...cells: string[]): SheetRow => ({ rowNumber: 1, cells });

describe('reading files', () => {
  it('reads CSV with quotes, a BOM and Windows line endings, numbering rows like a spreadsheet', async () => {
    const csv = '﻿sku,name,price\r\nA-1,"Mug, large",12.50\r\n\r\nA-2,"Say ""hi""",3\r\n';
    const rows = await rowsOf(Buffer.from(csv));
    expect(rows.map((r) => [r.rowNumber, r.cells])).toEqual([
      [1, ['sku', 'name', 'price']],
      [2, ['A-1', 'Mug, large', '12.50']],
      [3, ['']],
      [4, ['A-2', 'Say "hi"', '3']],
    ]);
  });

  it('reads semicolon- and tab-separated files', async () => {
    expect((await rowsOf(Buffer.from('sku;price\nA;1,50\n')))[1]!.cells).toEqual(['A', '1,50']);
    expect((await rowsOf(Buffer.from('sku\tprice\nA\t2\n')))[1]!.cells).toEqual(['A', '2']);
  });

  it('reads the first sheet of an .xlsx file, turning numbers back into what was typed', async () => {
    const content = await writeXlsxFile([
      ['sku', 'price', 'stock:QSW'],
      ['B-1', 12.3, 40],
      [1001, 0.1 + 0.2, 0],
    ]).toBuffer();
    expect(detectFormat(content)).toBe('xlsx');
    const rows = await rowsOf(content);
    expect(rows.map((r) => r.cells)).toEqual([
      ['sku', 'price', 'stock:QSW'],
      ['B-1', '12.3', '40'],
      ['1001', '0.3', '0'],
    ]);
  });

  it('rejects old .xls files and binary files with a useful message', () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => detectFormat(xls)).toThrow(/old \.xls file/);
    expect(() => detectFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]))).toThrow(/not a CSV or an Excel/);
  });

  it('reports where a CSV is malformed', async () => {
    await expect(rowsOf(Buffer.from('sku,name\nA,"unclosed\n'))).rejects.toThrow(ImportFileError);
  });
});

describe('columns', () => {
  it('maps fixed columns and stock columns per store, in any case or spelling', () => {
    const map = mapColumns(header('SKU', 'Name', 'Reorder Point', 'stock:qsw', 'Stock_WH'), stores);
    expect(map.fields).toEqual({ sku: 0, name: 1, reorderPoint: 2 });
    expect(map.stock).toEqual([
      { index: 3, storeId: 'store-qsw', code: 'QSW' },
      { index: 4, storeId: 'store-wh', code: 'WH' },
    ]);
  });

  it.each([
    [['name', 'price'], /"sku" column/],
    [['sku'], /at least one column/],
    [['sku', 'prise'], /Unknown column "prise"/],
    [['sku', 'price', 'Price'], /appears twice/],
    [['sku', 'stock:XYZ'], /store code you don't have. Your stores: QSW, WH/],
  ])('rejects the header %j', (cells, message) => {
    expect(() => mapColumns(header(...cells), stores)).toThrow(message);
  });
});

describe('rows', () => {
  const map = mapColumns(header('sku', 'name', 'price', 'reorder_point', 'stock:QSW', 'stock:WH'), stores);
  const row = (...cells: string[]) => parseRow({ rowNumber: 7, cells }, map);

  it('parses a full row; empty cells mean "leave unchanged"', () => {
    expect(row('MUG-1', 'Mug', '$1,299.5', '', '12', '')).toEqual({
      row: { rowNumber: 7, sku: 'MUG-1', name: 'Mug', priceCents: 129950, stock: [{ storeId: 'store-qsw', quantity: 12 }] },
    });
  });

  it('collects every problem in a row, with its column', () => {
    const result = row('bad sku!', '', '12.345', '-1', 'ten', '');
    expect('errors' in result && result.errors.map((e) => [e.column, e.message])).toEqual([
      ['sku', 'Use letters, numbers, dots, dashes, slashes or underscores'],
      ['price', 'Use at most 2 decimal places'],
      ['reorder_point', 'Use a whole number, 0 or more'],
      ['stock:QSW', 'Use a whole number, 0 or more'],
    ]);
  });

  it('requires a SKU', () => {
    const result = row('', 'Nameless', '1', '', '', '');
    expect('errors' in result && result.errors[0]).toMatchObject({ rowNumber: 7, sku: null, message: 'SKU is missing' });
  });
});
