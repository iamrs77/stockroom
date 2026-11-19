import type { ImportSummary } from '@stockroom/shared';
import { cx } from '@/lib/cx';
import { formatNumber } from '@/lib/format';
import { importPercent } from '../import-percent';

/** A progress bar for an import, readable by screen readers ("1,000 of 30,000 rows"). Red if it failed. */
export function ImportProgressBar({ summary, className }: { summary: ImportSummary; className?: string }) {
  const percent = importPercent(summary);
  const label = summary.totalRows
    ? `${formatNumber(summary.processedRows)} of ${formatNumber(summary.totalRows)} rows`
    : 'Waiting to start';
  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cx('h-full rounded-full transition-[width] duration-300', summary.status === 'failed' ? 'bg-danger' : 'bg-accent')}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
