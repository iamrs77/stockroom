import { isImportFinished, type ImportSummary } from '@stockroom/shared';
import { Link } from 'react-router';
import { formatBytes, formatNumber, formatRelative } from '@/lib/format';
import { ImportProgressBar } from './ImportProgressBar';
import { ImportStatusBadge } from './ImportStatusBadge';

/** One import in the list: file, status, who uploaded it, and its counts or a progress bar. */
export function RecentImportRow({ item }: { item: ImportSummary }) {
  return (
    <li>
      <Link to={`/imports/${item.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 hover:bg-surface-2">
        <div className="min-w-48 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{item.fileName}</span>
            <ImportStatusBadge status={item.status} />
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {formatRelative(item.createdAt)}
            {item.userName && <> by {item.userName}</>} · {formatBytes(item.fileSize)}
          </div>
        </div>
        {isImportFinished(item.status) ? (
          <div className="flex gap-5 text-sm text-muted tabular-nums">
            <span>
              <span className="font-medium text-ink">{formatNumber(item.createdCount)}</span> new
            </span>
            <span>
              <span className="font-medium text-ink">{formatNumber(item.updatedCount)}</span> updated
            </span>
            <span>
              <span className="font-medium text-ink">{formatNumber(item.stockChangeCount)}</span> stock changes
            </span>
            {item.errorCount > 0 && (
              <span className="text-warn">
                <span className="font-medium">{formatNumber(item.errorCount)}</span> skipped
              </span>
            )}
          </div>
        ) : (
          <ImportProgressBar summary={item} className="w-full sm:w-64" />
        )}
      </Link>
    </li>
  );
}
