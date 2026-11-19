import { isImportFinished } from '@stockroom/shared';
import { Info } from 'lucide-react';
import { useLocation, useParams } from 'react-router';
import { Alert, BackLink, PageHeader, PageLoadError, Spinner } from '@/components/ui';
import { formatBytes, formatDateTime } from '@/lib/format';
import { ImportProgressCard } from './components/ImportProgressCard';
import { ImportStat } from './components/ImportStat';
import { ImportStatusBadge } from './components/ImportStatusBadge';
import { SkippedRows } from './components/SkippedRows';
import { useImport } from './imports-api';
import { useImportEvents } from './useImportEvents';

export function ImportDetailPage() {
  const id = useParams().id!;
  // Set by the upload when the same file was already being imported.
  const duplicate = (useLocation().state as { duplicate?: boolean } | null)?.duplicate;
  const { data: detail, error, isPending } = useImport(id);
  useImportEvents(id, !!detail && !isImportFinished(detail.status));

  if (isPending) return <Spinner label="Loading import" />;
  if (error || !detail) {
    return <PageLoadError message={error?.message ?? 'Import not found'} backTo="/imports" backLabel="Back to imports" />;
  }

  return (
    <>
      <BackLink to="/imports">Imports</BackLink>
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

      <ImportProgressCard detail={detail} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <ImportStat label="New products" value={detail.createdCount} />
        <ImportStat label="Products updated" value={detail.updatedCount} />
        <ImportStat label="Stock changes" value={detail.stockChangeCount} />
        <ImportStat label="Rows skipped" value={detail.errorCount} warn={detail.errorCount > 0} />
      </div>

      {detail.errorCount > 0 && <SkippedRows detail={detail} />}
    </>
  );
}
