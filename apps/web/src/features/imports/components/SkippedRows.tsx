import { isImportFinished, type ImportDetail } from '@stockroom/shared';
import { Download } from 'lucide-react';
import { Card } from '@/components/ui';
import { cx } from '@/lib/cx';
import { formatNumber } from '@/lib/format';
import { SkippedRowsTable } from './SkippedRowsTable';

/** The rows an import couldn't use, and a link to download them all as a report. */
export function SkippedRows({ detail }: { detail: ImportDetail }) {
  // Live updates carry the count; the list itself is fetched once the import finishes.
  const finished = isImportFinished(detail.status);
  const listed = finished && detail.errors.length > 0;

  return (
    <Card className="overflow-hidden">
      <div className={cx('flex flex-wrap items-center justify-between gap-3 px-4 py-3', listed && 'border-b border-line')}>
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
      {listed && <SkippedRowsTable errors={detail.errors} />}
    </Card>
  );
}
