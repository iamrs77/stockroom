import type { ImportStatus, ImportSummary } from '@stockroom/shared';
import { CircleCheck, CircleX, Clock, LoaderCircle } from 'lucide-react';
import { formatNumber } from '../lib/format';
import { cx } from './ui';

const statusStyles: Record<ImportStatus, { label: string; className: string; icon: typeof Clock }> = {
  queued: { label: 'Queued', className: 'bg-surface-2 text-muted', icon: Clock },
  processing: { label: 'Importing', className: 'bg-accent-bg text-accent', icon: LoaderCircle },
  completed: { label: 'Done', className: 'bg-accent-bg text-accent', icon: CircleCheck },
  failed: { label: 'Failed', className: 'bg-danger-bg text-danger', icon: CircleX },
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const { label, className, icon: Icon } = statusStyles[status];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      <Icon className={cx('size-3.5', status === 'processing' && 'animate-spin')} aria-hidden />
      {label}
    </span>
  );
}

export function importPercent(summary: ImportSummary) {
  if (summary.status === 'completed') return 100;
  if (!summary.totalRows) return 0;
  return Math.min(100, Math.floor((summary.processedRows / summary.totalRows) * 100));
}

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
