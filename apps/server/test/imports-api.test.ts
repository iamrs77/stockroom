import type { ImportDetail, ImportSummary } from '@stockroom/shared';
import { eq } from 'drizzle-orm';
import writeXlsxFile from 'write-excel-file/node';
import { describe, expect, inject, it } from 'vitest';
import { imports } from '@/db/schema';
import { ImportEvents } from '@/modules/imports/events';
import { startImportWorker } from '@/modules/imports/queue';
import { setupTestApp, signUp, silentLogger, waitFor } from './helpers';

const { app, db } = setupTestApp({ worker: true, importChunkSize: 2 });
// A second app with no worker, for checking what happens while an import is still queued.
const { app: queuedOnlyApp, importQueue: queuedOnlyQueue, prefix: queuedOnlyPrefix } = setupTestApp();

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];

const upload = (agent: Agent, content: Buffer | string, fileName = 'products.csv') =>
  agent
    .post('/api/imports')
    .query({ fileName })
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from(content));

const waitUntilFinished = (agent: Agent, id: string) =>
  waitFor(async () => {
    const res = await agent.get(`/api/imports/${id}`);
    const detail = res.body as ImportDetail;
    return detail.status === 'completed' || detail.status === 'failed' ? detail : undefined;
  });

describe('imports API', () => {
  it('accepts an upload, processes it in the background and shows the result', async () => {
    const { agent } = await signUp(app);
    const res = await upload(agent, 'sku,name,price,stock:MAIN\nA-1,Apple,1.50,10\nB-1,Banana,0.75,4\nC-1,Cherry,3,0\n');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ duplicate: false, import: { status: 'queued', fileName: 'products.csv', format: 'csv' } });

    const done = await waitUntilFinished(agent, res.body.import.id);
    expect(done).toMatchObject({ status: 'completed', totalRows: 3, processedRows: 3, createdCount: 3, stockChangeCount: 2 });

    const list = await agent.get('/api/products').query({ sort: 'sku' });
    expect(list.body.items.map((p: { sku: string; totalStock: number }) => [p.sku, p.totalStock])).toEqual([
      ['A-1', 10],
      ['B-1', 4],
      ['C-1', 0],
    ]);
    const history = await agent.get(`/api/products/${list.body.items[0].id}/movements`);
    expect(history.body.items[0]).toMatchObject({ reason: 'import', note: 'Import: products.csv', delta: 10 });

    const recent = await agent.get('/api/imports');
    expect(recent.body.items.map((i: ImportSummary) => i.id)).toEqual([res.body.import.id]);
  });

  it('imports .xlsx files too', async () => {
    const { agent } = await signUp(app);
    const xlsx = await writeXlsxFile([
      ['sku', 'name', 'price', 'stock:MAIN'],
      ['X-1', 'From Excel', 9.99, 3],
    ]).toBuffer();
    const res = await upload(agent, xlsx, 'stock.xlsx');
    expect(res.body.import.format).toBe('xlsx');
    expect(await waitUntilFinished(agent, res.body.import.id)).toMatchObject({ status: 'completed', createdCount: 1 });
  });

  it('streams progress as server-sent events and ends the stream when the import finishes', async () => {
    const { agent } = await signUp(app);
    const rows = Array.from({ length: 10 }, (_, i) => `S-${i},Item ${i},1,${i}`);
    const res = await upload(agent, ['sku,name,price,stock:MAIN', ...rows].join('\n'));

    const stream = await agent.get(`/api/imports/${res.body.import.id}/events`).buffer(true).parse((r, done) => {
      let text = '';
      r.on('data', (chunk: Buffer) => (text += chunk.toString()));
      r.on('end', () => done(null, text));
    });
    expect(stream.headers['content-type']).toMatch(/text\/event-stream/);
    const events = (stream.body as string)
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)) as ImportSummary);

    expect(events.at(-1)).toMatchObject({ status: 'completed', processedRows: 10 });
    // Progress never goes backwards.
    const progress = events.map((e) => e.processedRows);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('returns the existing import when the same file is uploaded again while it is queued', async () => {
    const { agent } = await signUp(queuedOnlyApp);
    const csv = 'sku,name,price\nD-1,Date,2\n';
    const first = await upload(agent, csv);
    const again = await upload(agent, csv, 'renamed.csv');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, import: { id: first.body.import.id, fileName: 'products.csv' } });
    // Only one job was queued.
    expect(await queuedOnlyQueue.queue.getJobCountByTypes('waiting')).toBe(1);
  });

  it('serves a problem report that is safe to open in a spreadsheet', async () => {
    const { agent } = await signUp(app);
    const res = await upload(agent, 'sku,name,price\nOK-1,Fine,1\n=HYPERLINK("x"),Evil,1\nOK-2,"Comma, name",abc\n');
    const done = await waitUntilFinished(agent, res.body.import.id);
    expect(done.errorCount).toBe(2);

    const report = await agent.get(`/api/imports/${res.body.import.id}/errors.csv`);
    expect(report.headers['content-type']).toMatch(/text\/csv/);
    expect(report.headers['content-disposition']).toContain('products-problems.csv');
    const lines = report.text.trim().split('\r\n');
    expect(lines[0]).toBe('row,sku,column,problem');
    // The formula is neutralised with a leading apostrophe, so Excel shows it as text.
    expect(lines[1]).toMatch(/^3,"'=HYPERLINK\(""x""\)",sku,/);
    expect(lines[2]).toBe('4,OK-2,price,Use a number like 12.50');
  });

  it('offers a template with the business’s own store codes', async () => {
    const { agent } = await signUp(app);
    await agent.post('/api/stores').send({ name: 'Warehouse', code: 'WH' });
    const res = await agent.get('/api/imports/template.csv');
    expect(res.text.split('\r\n')[0]).toBe('sku,name,category,price,reorder_point,stock:MAIN,stock:WH');
  });

  it('rejects empty, unsupported and oversized files', async () => {
    const { agent } = await signUp(app);
    expect((await upload(agent, '')).body.error.code).toBe('empty_file');
    const png = await upload(agent, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), 'photo.png');
    expect(png.status).toBe(400);
    expect(png.body.error.code).toBe('unsupported_file');
    const huge = await upload(agent, Buffer.alloc(21 * 1024 * 1024, 'a'));
    expect(huge.status).toBe(413);
  });

  it("keeps each business's imports private", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const res = await upload(alice.agent, 'sku,name,price\nP-1,Pear,1\n');
    const id = res.body.import.id as string;
    await waitUntilFinished(alice.agent, id);

    expect((await bob.agent.get(`/api/imports/${id}`)).status).toBe(404);
    expect((await bob.agent.get(`/api/imports/${id}/events`)).status).toBe(404);
    expect((await bob.agent.get(`/api/imports/${id}/errors.csv`)).status).toBe(404);
    expect((await bob.agent.get('/api/imports')).body.items).toEqual([]);
  });

  it('picks up an import that was saved but never queued (the sweeper)', async () => {
    const { agent } = await signUp(queuedOnlyApp);
    const res = await upload(agent, 'sku,name,price\nL-1,Lost,1\n');
    const id = res.body.import.id as string;
    // Simulate Redis losing the job: remove it, and age the import past the sweeper's threshold.
    await queuedOnlyQueue.queue.remove(id);
    await db.update(imports).set({ updatedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(imports.id, id));

    // A worker sharing that queue finds and finishes it.
    const worker = startImportWorker({
      db,
      redisUrl: inject('redisUrl'),
      prefix: queuedOnlyPrefix,
      logger: silentLogger,
      events: new ImportEvents({ prefix: queuedOnlyPrefix, logger: silentLogger }),
      importQueue: queuedOnlyQueue,
      concurrency: 1,
      chunkSize: 100,
    });
    try {
      expect(await waitUntilFinished(agent, id)).toMatchObject({ status: 'completed', createdCount: 1 });
    } finally {
      await worker.close();
    }
  });
});
