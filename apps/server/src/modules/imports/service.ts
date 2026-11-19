import { createHash } from 'node:crypto';
import type { ImportDetail, ImportRowError, ImportSummary } from '@stockroom/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { pgError, PG_UNIQUE_VIOLATION, type Db, type Executor } from '@/db/client';
import { importErrors, importFiles, imports, stores, users } from '@/db/schema';
import { notFound } from '@/http/errors';
import type { ImportFormat } from './read-rows';

const summaryColumns = {
  id: imports.id,
  fileName: imports.fileName,
  fileSize: imports.fileSize,
  format: imports.format,
  status: imports.status,
  totalRows: imports.totalRows,
  processedRows: imports.processedRows,
  createdCount: imports.createdCount,
  updatedCount: imports.updatedCount,
  stockChangeCount: imports.stockChangeCount,
  errorCount: imports.errorCount,
  failureReason: imports.failureReason,
  userName: users.name,
  createdAt: imports.createdAt,
  startedAt: imports.startedAt,
  finishedAt: imports.finishedAt,
};

type Row = { [K in keyof typeof summaryColumns]: unknown } & { createdAt: Date; startedAt: Date | null; finishedAt: Date | null };

/** Dates as ISO strings, as they appear in JSON, so API responses and progress events match exactly. */
function toSummary(row: Row): ImportSummary {
  return {
    ...(row as unknown as ImportSummary),
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function getImportSummary(db: Executor, tenantId: string, importId: string): Promise<ImportSummary> {
  const [row] = await db
    .select(summaryColumns)
    .from(imports)
    .leftJoin(users, eq(users.id, imports.userId))
    .where(and(eq(imports.id, importId), eq(imports.tenantId, tenantId)));
  if (!row) throw notFound('Import');
  return toSummary(row);
}

export async function listImports(db: Executor, tenantId: string, limit = 25): Promise<ImportSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(imports)
    .leftJoin(users, eq(users.id, imports.userId))
    .where(eq(imports.tenantId, tenantId))
    .orderBy(desc(imports.createdAt))
    .limit(limit);
  return rows.map(toSummary);
}

export async function getImportDetail(db: Executor, tenantId: string, importId: string): Promise<ImportDetail> {
  const summary = await getImportSummary(db, tenantId, importId);
  const errors = await listImportErrors(db, importId, 50);
  return { ...summary, errors };
}

export async function listImportErrors(db: Executor, importId: string, limit?: number): Promise<ImportRowError[]> {
  const query = db
    .select({ rowNumber: importErrors.rowNumber, sku: importErrors.sku, column: importErrors.column, message: importErrors.message })
    .from(importErrors)
    .where(eq(importErrors.importId, importId))
    .orderBy(asc(importErrors.rowNumber), asc(importErrors.id));
  return limit ? query.limit(limit) : query;
}

/**
 * Records an upload. If the same file is already queued or running for this business, returns
 * that import instead, so a double-click or a retried upload can't import a file twice at once.
 */
export async function createImport(
  db: Db,
  input: { tenantId: string; userId: string; fileName: string; content: Buffer; format: ImportFormat },
): Promise<{ summary: ImportSummary; duplicate: boolean }> {
  const fileHash = createHash('sha256').update(input.content).digest('hex');
  try {
    const id = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(imports)
        .values({
          tenantId: input.tenantId,
          userId: input.userId,
          fileName: input.fileName,
          fileSize: input.content.length,
          fileHash,
          format: input.format,
        })
        .returning({ id: imports.id });
      if (!created) throw new Error('Import insert returned nothing');
      await tx.insert(importFiles).values({ importId: created.id, content: input.content });
      return created.id;
    });
    return { summary: await getImportSummary(db, input.tenantId, id), duplicate: false };
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code !== PG_UNIQUE_VIOLATION || pg.constraint !== 'imports_active_file_key') throw err;
    const [active] = await db
      .select({ id: imports.id })
      .from(imports)
      .where(
        and(
          eq(imports.tenantId, input.tenantId),
          eq(imports.fileHash, fileHash),
          inArray(imports.status, ['queued', 'processing']),
        ),
      );
    // It finished in the instant between the insert and this read: let the client upload again.
    if (!active) throw err;
    return { summary: await getImportSummary(db, input.tenantId, active.id), duplicate: true };
  }
}

/**
 * Makes a value safe to open in a spreadsheet: quotes it for CSV, and neutralises cells that a
 * spreadsheet would run as a formula (CSV injection). SKUs and names come from user uploads.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (values: (string | number | null)[]) => `${values.map(csvCell).join(',')}\r\n`;

/** A starter file with this business's real store codes as stock columns. */
export async function importTemplate(db: Executor, tenantId: string): Promise<string> {
  const tenantStores = await db.select({ code: stores.code }).from(stores).where(eq(stores.tenantId, tenantId)).orderBy(asc(stores.code));
  const stockColumns = tenantStores.map((s) => `stock:${s.code}`);
  const example = (values: (string | number)[], stock: number[]) => csvLine([...values, ...tenantStores.map((_, i) => stock[i % stock.length]!)]);
  return (
    csvLine(['sku', 'name', 'category', 'price', 'reorder_point', ...stockColumns]) +
    example(['TEA-0101', 'Earl Grey, 250 g', 'Coffee & Tea', '12.99', 10], [24, 12, 80]) +
    example(['MUG-0001', 'Ceramic Mug, Sage', 'Kitchen', '18.00', 5], [6, 4, 40])
  );
}
