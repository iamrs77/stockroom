import { IMPORT_MAX_BYTES, importStatuses, isImportFinished, type ImportSummary } from '@stockroom/shared';
import express, { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { getAuth } from '../../http/auth';
import { HttpError } from '../../http/errors';
import { parse, parseId } from '../../http/validate';
import { MAX_STORED_ERRORS } from './process';
import { detectFormat, ImportFileError } from './read-rows';
import {
  createImport,
  csvLine,
  getImportDetail,
  getImportSummary,
  importTemplate,
  listImportErrors,
  listImports,
} from './service';

const uploadQuerySchema = z.object({ fileName: z.string().trim().min(1, 'File name is missing').max(200) });

/** Stops the browser and proxies from caching or buffering a download or an event stream. */
const noStore = { 'Cache-Control': 'no-store' };

export function importsRouter(deps: AppDeps) {
  const { db, imports } = deps;
  const router = Router();

  router.get('/template.csv', async (req, res) => {
    const { tenant } = getAuth(req);
    res
      .set({ ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="stockroom-import-template.csv"' })
      .send(await importTemplate(db, tenant.id));
  });

  router.get('/', async (req, res) => {
    const { tenant } = getAuth(req);
    res.json({ items: await listImports(db, tenant.id) });
  });

  // The file is the raw request body, so the upload needs no multipart parsing.
  router.post('/', express.raw({ type: () => true, limit: IMPORT_MAX_BYTES }), async (req, res) => {
    const auth = getAuth(req);
    const { fileName } = parse(uploadQuerySchema, req.query);
    const content: unknown = req.body;
    if (!Buffer.isBuffer(content) || content.length === 0) {
      throw new HttpError(400, 'empty_file', 'The file is empty');
    }
    let format;
    try {
      format = detectFormat(content);
    } catch (err) {
      if (err instanceof ImportFileError) throw new HttpError(400, 'unsupported_file', err.message);
      throw err;
    }

    // The import is saved in Postgres first, then queued. Saving is what counts: if queueing
    // fails, the sweeper queues it later, so the upload still succeeds.
    const { summary, duplicate } = await createImport(db, { tenantId: auth.tenant.id, userId: auth.id, fileName, content, format });
    if (!duplicate) await imports.queue.enqueue(summary.id);
    res.status(duplicate ? 200 : 202).json({ import: summary, duplicate });
  });

  router.get('/:id', async (req, res) => {
    const { tenant } = getAuth(req);
    res.json(await getImportDetail(db, tenant.id, parseId(req.params.id, 'Import')));
  });

  router.get('/:id/errors.csv', async (req, res) => {
    const { tenant } = getAuth(req);
    const id = parseId(req.params.id, 'Import');
    const summary = await getImportSummary(db, tenant.id, id); // 404s for another business's import
    const errors = await listImportErrors(db, id);
    let body = csvLine(['row', 'sku', 'column', 'problem']);
    for (const e of errors) body += csvLine([e.rowNumber, e.sku, e.column, e.message]);
    if (summary.errorCount > errors.length && errors.length >= MAX_STORED_ERRORS) {
      body += csvLine(['', '', '', `Only the first ${MAX_STORED_ERRORS} problems are listed. Fix these and import again to see the rest.`]);
    }
    const name = summary.fileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-');
    res
      .set({ ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-problems.csv"` })
      .send(body);
  });

  /**
   * Server-sent events with the import's progress. Sends the current state straight away, then each
   * update the worker publishes, and closes when the import finishes. EventSource reconnects by
   * itself after a dropped connection, and the first message after a reconnect is the current state,
   * so nothing is missed.
   */
  router.get('/:id/events', async (req, res) => {
    const { tenant } = getAuth(req);
    const id = parseId(req.params.id, 'Import');

    // Listen before reading the current state, so an update in between isn't lost.
    let last: ImportSummary | undefined;
    const pending: ImportSummary[] = [];
    let ready = false;
    const stopListening = imports.events.listen(id, (summary) => (ready ? send(summary) : pending.push(summary)));
    let current: ImportSummary;
    try {
      current = await getImportSummary(db, tenant.id, id);
    } catch (err) {
      stopListening();
      throw err;
    }

    res.writeHead(200, {
      ...noStore,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tells nginx-style proxies not to buffer the stream
    });
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      stopListening();
      res.end();
    };
    req.on('close', close);

    // Updates can arrive out of order (the state read above vs. a message in flight); never go backwards.
    const rank = (s: ImportSummary) => importStatuses.indexOf(s.status) * 1e9 + s.processedRows;
    function send(summary: ImportSummary) {
      if (last && rank(summary) < rank(last)) return;
      last = summary;
      res.write(`data: ${JSON.stringify(summary)}\n\n`);
      if (isImportFinished(summary.status)) close();
    }

    send(current);
    ready = true;
    for (const summary of pending) send(summary);
  });

  return router;
}
