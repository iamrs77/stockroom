import { isImportFinished, type ImportDetail } from '@stockroom/shared';
import { Card } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { formatDuration, formatNumber } from '@/lib/format';
import { importPercent } from '../import-percent';
import { ImportProgressBar } from './ImportProgressBar';

/** The big percentage, rows done, time taken and speed, with the progress bar. */
export function ImportProgressCard({ detail }: { detail: ImportDetail }) {
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
