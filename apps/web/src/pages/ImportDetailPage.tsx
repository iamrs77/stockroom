import { isImportFinished, type ImportDetail } from '@stockroom/shared';
import { ArrowLeft, Download, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useImport, useImportEvents } from '../api/queries';
import { importPercent, ImportProgressBar, ImportStatusBadge } from '../components/ImportStatus';
import { Alert, Card, PageHeader, Spinner } from '../components/ui';
import { formatBytes, formatDateTime, formatDuration, formatNumber } from '../lib/format';

export function ImportDetailPage() {
  const id = useParams().id!;
  const duplicate = (useLocation().state as { duplicate?: boolean } | null)?.duplicate;
  const { data: detail, error, isPending } = useImport(id);
  useImportEvents(id, !!detail && !isImportFinished(detail.status));

  if (isPending) return <Spinner label="Loading import" />;
  if (error || !detail) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert>{error?.message ?? 'Import not found'}</Alert>
        <Link to="/imports" className="text-sm font-medium text-accent hover:underline">
          Back to imports
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/imports" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Imports
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="break-all">{detail.fileName}</span>
            <ImportStatusBadge status={detail.status} />
          </span>
        }
        description={
          <>
            Uploaded {formatDateTime(detail.createdAt)}
            {detail.userName && <> by {detail.userName}</>} · {detail.format.toUpperCase()} · {formatBytes(detail.fileSize)}
          </>
        }
      />

      {duplicate && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          This file was already being imported, so this is that import rather than a second copy.
        </div>
      )}
      {detail.status === 'failed' && detail.failureReason && (
        <div className="mb-4">
          <Alert>{detail.failureReason}</Alert>
        </div>
      )}

      <Progress detail={detail} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="New products" value={detail.createdCount} />
        <Stat label="Products updated" value={detail.updatedCount} />
        <Stat label="Stock changes" value={detail.stockChangeCount} />
        <Stat label="Rows skipped" value={detail.errorCount} warn={detail.errorCount > 0} />
      </div>

      {detail.errorCount > 0 && <Problems detail={detail} />}
    </>
  );
}

function Progress({ detail }: { detail: ImportDetail }) {
  const finished = isImportFinished(detail.status);
  const now = useNow(!finished && detail.status === 'processing');
  const started = detail.startedAt ? new Date(detail.startedAt).getTime() : undefined;
  const ended = detail.finishedAt ? new Date(detail.finishedAt).getTime() : now;
  const elapsed = started ? ended - started : 0;
  const rate = elapsed > 1000 ? Math.round(detail.processedRows / (elapsed / 1000)) : undefined;

  return (
    <Card className="mb-6 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-3xl font-semibold tabular-nums">{importPercent(detail)}%</span>
        <span className="text-sm text-muted tabular-nums">
          {detail.totalRows
            ? `${formatNumber(detail.processedRows)} of ${formatNumber(detail.totalRows)} rows`
            : detail.status === 'queued'
              ? 'Waiting for a worker'
              : 'Reading the file'}
          {started !== undefined && <> · {formatDuration(elapsed)}</>}
          {rate !== undefined && <> · {formatNumber(rate)} rows/s</>}
        </span>
      </div>
      <ImportProgressBar summary={detail} />
    </Card>
  );
}

/** The current time, ticking every second while active, for the elapsed-time display. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? 'text-warn' : ''}`}>{formatNumber(value)}</div>
    </Card>
  );
}

function Problems({ detail }: { detail: ImportDetail }) {
  // Live updates carry the count; the list itself is fetched once the import finishes.
  const finished = isImportFinished(detail.status);
  const listed = finished && detail.errors.length > 0;
  return (
    <Card className="overflow-hidden">
      <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${listed ? 'border-b border-line' : ''}`}>
        <div>
          <h2 className="font-semibold">Skipped rows</h2>
          <p className="text-sm text-muted">
            {!finished
              ? `${formatNumber(detail.errorCount)} so far. The list will appear here when the import finishes.`
              : detail.errors.length < detail.errorCount
                ? `Showing the first ${detail.errors.length} of ${formatNumber(detail.errorCount)}. The report has them all.`
                : 'Fix these rows and import the file again. Rows that were imported stay as they are.'}
          </p>
        </div>
        {finished && (
          <a
            href={`/api/imports/${detail.id}/errors.csv`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-surface-2"
          >
            <Download className="size-4" aria-hidden />
            Download report
          </a>
        )}
      </div>
      {listed && <ProblemTable detail={detail} />}
    </Card>
  );
}

function ProblemTable({ detail }: { detail: ImportDetail }) {
  return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-line bg-surface-2 text-left text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Row</th>
              <th scope="col" className="px-4 py-2 font-medium">SKU</th>
              <th scope="col" className="px-4 py-2 font-medium">Column</th>
              <th scope="col" className="px-4 py-2 font-medium">Problem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {detail.errors.map((e, i) => (
              <tr key={`${e.rowNumber}-${i}`}>
                <td className="px-4 py-2.5 tabular-nums">{e.rowNumber}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.sku ?? '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted">{e.column ?? '—'}</td>
                <td className="px-4 py-2.5">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
}
