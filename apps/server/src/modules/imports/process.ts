import { IMPORT_MAX_ROWS, type ImportSummary } from '@stockroom/shared';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { pgError, PG_UNIQUE_VIOLATION, type Db } from '../../db/client';
import { importErrors, importFiles, imports, stores, tenants } from '../../db/schema';
import type { Logger } from '../../logger';
import { importRowsProcessed } from '../../metrics';
import { recordEvent } from '../events/outbox';
import { applyChunk, type ChunkContext } from './apply-chunk';
import { mapColumns, parseRow, type ImportRow, type RowError } from './columns';
import { ImportFileError, isBlankRow, readRows, type SheetRow } from './read-rows';
import { getImportSummary } from './service';

/** Error rows kept per import. The count keeps going; the report says how many were left out. */
export const MAX_STORED_ERRORS = 1000;

export type ProcessOutcome =
  /** Finished, successfully or with a file-level failure. */
  | 'completed'
  | 'failed'
  /** Another import for the same business is running; try again shortly. */
  | 'busy'
  /** Asked to stop (shutdown) after a chunk; resume from the checkpoint later. */
  | 'stopped'
  /** Nothing to do (already finished), or another worker took over this import. */
  | 'skipped';

export type ProcessOptions = {
  chunkSize: number;
  logger: Logger;
  /** Checked between chunks. When aborted, processing stops cleanly at the last checkpoint. */
  signal?: AbortSignal;
  publish?: (summary: ImportSummary) => Promise<void> | void;
  /** Tells the outbox relay that new events may have been committed (alerts, completion). */
  pokeOutbox?: () => void;
  /** Most data rows a file may have, for real businesses and for demo sandboxes. */
  maxRows?: number;
  demoMaxRows?: number;
  /** Test hook, called after each committed chunk. */
  afterChunk?: (processedRows: number) => Promise<void> | void;
};

/** Another worker committed a chunk this one was about to commit. */
class Superseded extends Error {}

/**
 * Processes an import from its last checkpoint to the end.
 *
 * Each chunk's writes and its checkpoint commit in one transaction, so after a crash the import
 * resumes exactly where it stopped: no chunk is applied twice, and none is skipped. The checkpoint
 * also acts as a fencing token: a chunk only commits if the checkpoint still holds the value this
 * worker last saw. If a stalled job is ever handed to a second worker, only one of them can make
 * progress.
 */
export async function processImport(db: Db, importId: string, options: ProcessOptions): Promise<ProcessOutcome> {
  const { logger } = options;
  const claimed = await claim(db, importId);
  if (claimed === 'busy' || claimed === 'skipped') return claimed;
  const job = claimed;
  const publish = async () => {
    const summary = await getImportSummary(db, job.tenantId, importId);
    await options.publish?.(summary);
  };
  await publish();

  try {
    const [file] = await db.select({ content: importFiles.content }).from(importFiles).where(eq(importFiles.importId, importId));
    if (!file) throw new ImportFileError('The uploaded file is no longer available. Upload it again.');
    const tenantStores = await db.select({ id: stores.id, code: stores.code }).from(stores).where(eq(stores.tenantId, job.tenantId));

    // Pass 1: check the header and count rows before writing anything.
    let header: SheetRow | undefined;
    let totalRows = 0;
    for await (const row of readRows(file.content, job.format)) {
      if (!header) header = row;
      else totalRows++;
    }
    if (!header) throw new ImportFileError('The file is empty.');
    const columns = mapColumns(header, tenantStores);
    if (totalRows === 0) throw new ImportFileError('The file has a header but no rows.');
    const [owner] = await db.select({ demoExpiresAt: tenants.demoExpiresAt }).from(tenants).where(eq(tenants.id, job.tenantId));
    const isDemo = !!owner?.demoExpiresAt;
    const maxRows = isDemo ? (options.demoMaxRows ?? IMPORT_MAX_ROWS) : (options.maxRows ?? IMPORT_MAX_ROWS);
    if (totalRows > maxRows) {
      throw new ImportFileError(
        `The file has ${totalRows.toLocaleString('en-CA')} rows. The limit ${isDemo ? 'for demo businesses ' : ''}is ${maxRows.toLocaleString('en-CA')}.`,
      );
    }
    if (job.totalRows !== totalRows) {
      await db.update(imports).set({ totalRows, updatedAt: sql`now()` }).where(eq(imports.id, importId));
      await publish();
    }

    // Pass 2: validate every row (rows before the checkpoint too, so duplicate SKUs are caught
    // the same way on every attempt), and apply the rows after the checkpoint in chunks.
    const ctx: ChunkContext = { tenantId: job.tenantId, importId, userId: job.userId, note: `Import: ${job.fileName}` };
    const [{ stored } = { stored: 0 }] = await db
      .select({ stored: count() })
      .from(importErrors)
      .where(eq(importErrors.importId, importId));
    let storedErrors = stored;
    let checkpoint = job.processedRows;
    const firstRowBySku = new Map<string, number>();
    let index = 0;
    let chunk = { rows: [] as ImportRow[], errors: [] as RowError[], errorRows: 0, end: checkpoint };

    const commit = async () => {
      const result = await db.transaction(async (tx) => {
        // Claim the chunk first. If another worker moved the checkpoint, stop before writing anything.
        const moved = await tx
          .update(imports)
          .set({ processedRows: chunk.end, updatedAt: sql`now()` })
          .where(and(eq(imports.id, importId), eq(imports.processedRows, checkpoint), eq(imports.status, 'processing')))
          .returning({ id: imports.id });
        if (moved.length === 0) throw new Superseded();

        const applied = await applyChunk(tx, ctx, chunk.rows);
        const errors = [...chunk.errors, ...applied.errors].sort((a, b) => a.rowNumber - b.rowNumber);
        const toStore = errors.slice(0, Math.max(0, MAX_STORED_ERRORS - storedErrors));
        if (toStore.length) await tx.insert(importErrors).values(toStore.map((e) => ({ importId, ...e })));

        const errorRows = chunk.errorRows + new Set(applied.errors.map((e) => e.rowNumber)).size;
        await tx
          .update(imports)
          .set({
            createdCount: sql`${imports.createdCount} + ${applied.created}`,
            updatedCount: sql`${imports.updatedCount} + ${applied.updated}`,
            stockChangeCount: sql`${imports.stockChangeCount} + ${applied.stockChanges}`,
            errorCount: sql`${imports.errorCount} + ${errorRows}`,
          })
          .where(eq(imports.id, importId));
        return { stored: toStore.length };
      });
      storedErrors += result.stored;
      importRowsProcessed.inc(chunk.end - checkpoint);
      checkpoint = chunk.end;
      chunk = { rows: [], errors: [], errorRows: 0, end: checkpoint };
      options.pokeOutbox?.();
      await publish();
      await options.afterChunk?.(checkpoint);
    };

    let first = true;
    for await (const sheetRow of readRows(file.content, job.format)) {
      if (first) {
        first = false; // the header
        continue;
      }
      index++;
      const before = index <= checkpoint;
      if (isBlankRow(sheetRow.cells)) {
        if (!before) chunk.end = index;
      } else {
        const parsed = parseRow(sheetRow, columns);
        let errors: RowError[] | undefined = 'errors' in parsed ? parsed.errors : undefined;
        const sku = 'row' in parsed ? parsed.row.sku : parsed.sku;
        if (sku) {
          const firstRow = firstRowBySku.get(sku);
          if (firstRow === undefined) firstRowBySku.set(sku, sheetRow.rowNumber);
          else {
            errors = [
              ...(errors ?? []),
              { rowNumber: sheetRow.rowNumber, sku, column: null, message: `${sku} is also on row ${firstRow}. Each SKU can appear once.` },
            ];
          }
        }
        if (!before) {
          if (errors) {
            chunk.errors.push(...errors);
            chunk.errorRows++;
          } else if ('row' in parsed) {
            chunk.rows.push(parsed.row);
          }
          chunk.end = index;
        }
      }
      if (chunk.end - checkpoint >= options.chunkSize) {
        await commit();
        if (options.signal?.aborted) return 'stopped';
      }
    }
    if (chunk.end > checkpoint) await commit();

    await db.transaction(async (tx) => {
      const [done] = await tx
        .update(imports)
        .set({ status: 'completed', finishedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(imports.id, importId))
        .returning();
      await tx.delete(importFiles).where(eq(importFiles.importId, importId));
      if (done) {
        await recordEvent(tx, done.tenantId, 'import.completed', {
          importId,
          fileName: done.fileName,
          rows: done.totalRows,
          created: done.createdCount,
          updated: done.updatedCount,
          stockChanges: done.stockChangeCount,
          skipped: done.errorCount,
        });
      }
    });
    options.pokeOutbox?.();
    await publish();
    logger.info({ importId, rows: totalRows }, 'Import completed');
    if (totalRows >= 10_000) {
      // A big load leaves the planner's statistics stale until autovacuum notices; refresh them now
      // so the next queries get good plans (e.g. the low-stock index once thousands of products qualify).
      await db.execute(sql`analyze products, stock_levels`).catch((err: Error) => logger.warn({ err: err.message }, 'ANALYZE after import failed'));
    }
    return 'completed';
  } catch (err) {
    if (err instanceof Superseded) {
      logger.warn({ importId }, 'Another worker took over this import; stopping');
      return 'skipped';
    }
    if (err instanceof ImportFileError) {
      await failImport(db, importId, err.message);
      options.pokeOutbox?.();
      await publish();
      return 'failed';
    }
    throw err; // Probably temporary (e.g. the database went away). The queue retries from the checkpoint.
  }
}

type Claimed = typeof imports.$inferSelect;

/** Moves an import to "processing". Resuming an import that is already processing is allowed. */
async function claim(db: Db, importId: string): Promise<Claimed | 'busy' | 'skipped'> {
  try {
    const [row] = await db
      .update(imports)
      .set({ status: 'processing', startedAt: sql`coalesce(${imports.startedAt}, now())`, updatedAt: sql`now()` })
      .where(and(eq(imports.id, importId), inArray(imports.status, ['queued', 'processing'])))
      .returning();
    return row ?? 'skipped';
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === 'imports_one_processing_per_tenant_key') return 'busy';
    throw err;
  }
}

/** Marks an import failed with a reason a person can act on, and drops its file. */
export async function failImport(db: Db, importId: string, reason: string) {
  await db.transaction(async (tx) => {
    const [failed] = await tx
      .update(imports)
      .set({ status: 'failed', failureReason: reason, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(imports.id, importId), inArray(imports.status, ['queued', 'processing'])))
      .returning({ tenantId: imports.tenantId, fileName: imports.fileName });
    await tx.delete(importFiles).where(eq(importFiles.importId, importId));
    if (failed) await recordEvent(tx, failed.tenantId, 'import.failed', { importId, fileName: failed.fileName, reason });
  });
}
