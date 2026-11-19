import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFiles, imports, products, stockLevels, stockMovements } from '@/db/schema';
import { processImport } from '@/modules/imports/process';
import { createImport, getImportDetail } from '@/modules/imports/service';
import { setupTestApp, signUp, silentLogger } from './helpers';

const { app, db } = setupTestApp();

/** A business with two stores (MAIN and WH) and a function to import a CSV into it. */
async function setup() {
  const owner = await signUp(app);
  const wh = await owner.agent.post('/api/stores').send({ name: 'Warehouse', code: 'WH' });
  const tenantId = owner.user.tenant.id;

  const upload = async (csv: string, fileName = 'products.csv') => {
    const { summary } = await createImport(db, {
      tenantId,
      userId: owner.user.id,
      fileName,
      content: Buffer.from(csv),
      format: 'csv',
    });
    return summary.id;
  };
  const run = (importId: string, options: { chunkSize?: number; afterChunk?: (n: number) => void } = {}) =>
    processImport(db, importId, { chunkSize: options.chunkSize ?? 1000, logger: silentLogger, afterChunk: options.afterChunk });
  const detail = (importId: string) => getImportDetail(db, tenantId, importId);

  const stockOf = async (sku: string) => {
    const rows = await db
      .select({ store: stockLevels.storeId, quantity: stockLevels.quantity })
      .from(stockLevels)
      .innerJoin(products, eq(products.id, stockLevels.productId))
      .where(and(eq(products.tenantId, tenantId), eq(products.sku, sku)));
    return Object.fromEntries(rows.map((r) => [r.store === owner.mainStore.id ? 'MAIN' : 'WH', r.quantity]));
  };
  const movements = () =>
    db
      .select({ delta: stockMovements.delta, balanceAfter: stockMovements.balanceAfter, reason: stockMovements.reason, importId: stockMovements.importId })
      .from(stockMovements)
      .where(eq(stockMovements.tenantId, tenantId))
      .orderBy(asc(stockMovements.id));

  return { ...owner, tenantId, warehouseId: wh.body.id as string, upload, run, detail, stockOf, movements };
}

const HEADER = 'sku,name,category,price,reorder_point,stock:MAIN,stock:WH';

describe('processing an import', () => {
  it('creates products, sets stock and records every change in the ledger', async () => {
    const t = await setup();
    const id = await t.upload(`${HEADER}\nTEA-1,Earl Grey,Tea,12.99,10,24,80\nMUG-1,Mug,,18,,6,\n`);

    expect(await t.run(id)).toBe('completed');

    const detail = await t.detail(id);
    expect(detail).toMatchObject({
      status: 'completed',
      totalRows: 2,
      processedRows: 2,
      createdCount: 2,
      updatedCount: 0,
      stockChangeCount: 3,
      errorCount: 0,
      userName: 'Owner',
    });
    expect(await t.stockOf('TEA-1')).toEqual({ MAIN: 24, WH: 80 });
    expect(await t.stockOf('MUG-1')).toEqual({ MAIN: 6 });

    const ledger = await t.movements();
    expect(ledger).toHaveLength(3);
    expect(ledger.every((m) => m.reason === 'import' && m.importId === id && m.delta === m.balanceAfter)).toBe(true);

    // The file is deleted once it's no longer needed.
    expect(await db.select().from(importFiles).where(eq(importFiles.importId, id))).toEqual([]);
  });

  it('updates only the fields given and records stock differences, not totals', async () => {
    const t = await setup();
    await t.run(await t.upload(`${HEADER}\nTEA-1,Earl Grey,Tea,12.99,10,24,80\n`));
    await t.agent.post('/api/products').send({ sku: 'UNTOUCHED', name: 'Keep me', priceCents: 100 });

    // New price, counted 20 in MAIN (4 sold), WH unchanged, name and category left blank.
    const id = await t.upload('sku,name,category,price,stock:MAIN,stock:WH\nTEA-1,,,13.49,20,80\n', 'update.csv');
    expect(await t.run(id)).toBe('completed');

    expect(await t.detail(id)).toMatchObject({ createdCount: 0, updatedCount: 1, stockChangeCount: 1 });
    const [tea] = await db.select().from(products).where(and(eq(products.tenantId, t.tenantId), eq(products.sku, 'TEA-1')));
    expect(tea).toMatchObject({ name: 'Earl Grey', category: 'Tea', priceCents: 1349, reorderPoint: 10 });
    expect((await t.movements()).at(-1)).toMatchObject({ delta: -4, balanceAfter: 20, importId: id });
  });

  it('skips bad rows, reports them by row number, and applies the rest', async () => {
    const t = await setup();
    const id = await t.upload(
      [
        HEADER,
        'OK-1,Good,,5,,1,', //            row 2: fine
        'BAD-1,Bad price,,1.234,,1,', //  row 3: price
        'NEW-1,,,,,3,', //                row 4: new SKU without name or price
        'OK-1,Again,,5,,2,', //           row 5: duplicate of row 2
        ',No sku,,5,,,', //               row 6: no SKU
        'OK-2,Also good,,7,,,9', //       row 7: fine
      ].join('\n'),
    );
    expect(await t.run(id)).toBe('completed');

    const detail = await t.detail(id);
    expect(detail).toMatchObject({ createdCount: 2, errorCount: 4 });
    expect(detail.errors.map((e) => [e.rowNumber, e.column, e.message])).toEqual([
      [3, 'price', 'Use at most 2 decimal places'],
      [4, null, 'NEW-1 is a new SKU, so it needs a name and a price'],
      [5, null, 'OK-1 is also on row 2. Each SKU can appear once.'],
      [6, 'sku', 'SKU is missing'],
    ]);
    // Row 5 was skipped entirely, so row 2's stock stands.
    expect(await t.stockOf('OK-1')).toEqual({ MAIN: 1 });
  });

  it('fails the whole import for a bad header, before writing anything', async () => {
    const t = await setup();
    const id = await t.upload('sku,price,stock:NOPE\nA-1,1,1\n');
    expect(await t.run(id)).toBe('failed');
    const detail = await t.detail(id);
    expect(detail.status).toBe('failed');
    expect(detail.failureReason).toMatch(/stock:NOPE.*Your stores: MAIN, WH/);
    expect(await db.select().from(products).where(eq(products.tenantId, t.tenantId))).toEqual([]);
  });

  it('resumes from its checkpoint after a crash, without repeating or skipping rows', async () => {
    const t = await setup();
    const rows = Array.from({ length: 9 }, (_, i) => `SKU-${i},Item ${i},,${i + 1},,${i + 10},`);
    const id = await t.upload([HEADER, ...rows].join('\n'));

    // Crash after the second chunk of 2 rows has committed.
    let chunks = 0;
    await expect(
      t.run(id, {
        chunkSize: 2,
        afterChunk: () => {
          if (++chunks === 2) throw new Error('worker died');
        },
      }),
    ).rejects.toThrow('worker died');
    expect(await t.detail(id)).toMatchObject({ status: 'processing', processedRows: 4, createdCount: 4 });

    expect(await t.run(id, { chunkSize: 2 })).toBe('completed');
    expect(await t.detail(id)).toMatchObject({ processedRows: 9, createdCount: 9, stockChangeCount: 9 });
    expect(await t.movements()).toHaveLength(9);
  });

  it('is harmless to apply rows again if a checkpoint is ever lost', async () => {
    const t = await setup();
    const id = await t.upload(`${HEADER}\nA-1,Apple,,1,,5,7\nB-1,Banana,,2,,3,\n`);
    // Every row commits, then the worker dies before marking the import complete.
    await expect(
      t.run(id, {
        afterChunk: () => {
          throw new Error('worker died');
        },
      }),
    ).rejects.toThrow('worker died');

    // Pretend the checkpoint was lost too, so the whole file runs again.
    await db.update(imports).set({ processedRows: 0 }).where(eq(imports.id, id));
    expect(await t.run(id)).toBe('completed');

    // Stock columns are counts, not changes, so the second pass finds nothing to change.
    expect(await t.movements()).toHaveLength(3);
    expect(await t.stockOf('A-1')).toEqual({ MAIN: 5, WH: 7 });
    expect(await t.detail(id)).toMatchObject({ createdCount: 2, updatedCount: 0, stockChangeCount: 3 });
  });

  it('lets only one of two workers make progress on the same import', async () => {
    const t = await setup();
    const rows = Array.from({ length: 40 }, (_, i) => `SKU-${i},Item ${i},,1,,${i + 1},`);
    const id = await t.upload([HEADER, ...rows].join('\n'));

    // Simulates a stalled job being handed to a second worker while the first is still running.
    const outcomes = await Promise.all([t.run(id, { chunkSize: 3 }), t.run(id, { chunkSize: 3 })]);
    expect(outcomes.sort()).toEqual(['completed', 'skipped']);
    expect(await t.detail(id)).toMatchObject({ processedRows: 40, createdCount: 40, stockChangeCount: 40 });
    expect(await t.movements()).toHaveLength(40);
  });

  it('runs one import at a time per business', async () => {
    const t = await setup();
    const first = await t.upload(`${HEADER}\nA-1,Apple,,1,,1,\n`, 'first.csv');
    const second = await t.upload(`${HEADER}\nB-1,Banana,,1,,1,\n`, 'second.csv');
    await db.update(imports).set({ status: 'processing' }).where(eq(imports.id, first));

    expect(await t.run(second)).toBe('busy');
    expect(await t.run(first)).toBe('completed');
    expect(await t.run(second)).toBe('completed');
  });

  it('does nothing for an import that already finished', async () => {
    const t = await setup();
    const id = await t.upload(`${HEADER}\nA-1,Apple,,1,,1,\n`);
    await t.run(id);
    expect(await t.run(id)).toBe('skipped');
  });
});
