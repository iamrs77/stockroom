import { parse } from 'csv-parse';
import { readSheet } from 'read-excel-file/node';

export type ImportFormat = 'csv' | 'xlsx';

/** A problem with the file as a whole. The import fails with this message; retrying won't help. */
export class ImportFileError extends Error {}

export type SheetRow = {
  /** The row number a person sees in a spreadsheet app (the header is row 1). */
  rowNumber: number;
  cells: string[];
};

const ZIP_SIGNATURE = 0x504b0304; // .xlsx files are zip archives
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .xls

/** Works out the format from the file's bytes rather than trusting its name. */
export function detectFormat(content: Buffer): ImportFormat {
  if (content.length >= 4 && content.readUInt32BE(0) === ZIP_SIGNATURE) return 'xlsx';
  if (content.subarray(0, OLE_SIGNATURE.length).equals(OLE_SIGNATURE)) {
    throw new ImportFileError('This is an old .xls file. Save it as .xlsx or .csv and upload it again.');
  }
  if (content.includes(0)) {
    throw new ImportFileError('This file is not a CSV or an Excel (.xlsx) file.');
  }
  return 'csv';
}

/** Picks comma, semicolon or tab, whichever the header line uses most. Some Excel locales save CSV with semicolons. */
function detectDelimiter(content: Buffer): string {
  const firstLine = content.subarray(0, 64 * 1024).toString('utf8').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    // Spreadsheets store 12.3 as 12.299999…; 15 significant digits gives back what the person typed.
    return String(Number(value.toPrecision(15)));
  }
  return String(value).trim();
}

/** Reads every row of the file, header included. Reading again starts from the beginning. */
export async function* readRows(content: Buffer, format: ImportFormat): AsyncGenerator<SheetRow> {
  if (format === 'xlsx') {
    let data: unknown[][];
    try {
      data = (await readSheet(content)) as unknown[][];
    } catch {
      throw new ImportFileError('Could not read this Excel file. Check that it opens in Excel, then save it as .xlsx again.');
    }
    for (let i = 0; i < data.length; i++) {
      yield { rowNumber: i + 1, cells: (data[i] ?? []).map(cellToString) };
    }
    return;
  }

  const parser = parse(content, {
    bom: true,
    delimiter: detectDelimiter(content),
    relax_column_count: true,
    // Accept a stray quote inside an unquoted cell (12" pizza), common in hand-made files.
    // A quote that opens a cell and never closes is still an error.
    relax_quotes: true,
    skip_empty_lines: false,
    trim: true,
    info: true,
  });
  try {
    for await (const { record, info } of parser as AsyncIterable<{ record: string[]; info: { lines: number } }>) {
      yield { rowNumber: info.lines, cells: record };
    }
  } catch (err) {
    const line = (err as { lines?: number }).lines;
    throw new ImportFileError(
      `The CSV couldn't be read${line ? ` near line ${line}` : ''}: ${(err as Error).message}. Check for a stray quote mark.`,
    );
  }
}

export const isBlankRow = (cells: string[]) => cells.every((cell) => cell === '');
