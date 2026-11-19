import { IMPORT_MAX_BYTES, isImportFinished } from '@stockroom/shared';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useImports, useUploadImport } from '../api/queries';
import { ImportProgressBar, ImportStatusBadge } from '../components/ImportStatus';
import { Alert, Card, cx, PageHeader, Spinner } from '../components/ui';
import { formatBytes, formatNumber, formatRelative } from '../lib/format';

const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function ImportsPage() {
  return (
    <>
      <PageHeader
        title="Imports"
        description="Add or update many products and stock counts at once from a spreadsheet."
      />
      <div className="mb-8 grid gap-6 lg:grid-cols-5">
        <UploadCard />
        <Card className="p-5 text-sm lg:col-span-2">
          <h2 className="mb-3 font-semibold">How it works</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
            <li>
              One row per product. <span className="font-mono text-ink">sku</span> is required; other columns are optional.
            </li>
            <li>Rows with a new SKU create a product, so they need a name and a price.</li>
            <li>An empty cell leaves that value as it is.</li>
            <li>
              <span className="font-mono text-ink">stock:QSW</span> columns are counted quantities for each store. The
              difference is recorded in each product&rsquo;s history.
            </li>
            <li>Rows with a problem are skipped and listed in a report. The rest are still imported.</li>
          </ul>
          <a
            href="/api/imports/template.csv"
            className="mt-4 inline-flex items-center gap-2 font-medium text-accent hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Download a template with your store codes
          </a>
        </Card>
      </div>
      <RecentImports />
    </>
  );
}

function UploadCard() {
  const upload = useUploadImport();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string>();

  function send(file: File | undefined) {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setLocalError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(IMPORT_MAX_BYTES)}.`);
      return;
    }
    setLocalError(undefined);
    upload.mutate(file, {
      onSuccess: (result) => navigate(`/imports/${result.import.id}`, { state: { duplicate: result.duplicate } }),
    });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    send(event.dataTransfer.files[0]);
  }

  const error = localError ?? upload.error?.message;
  return (
    <Card className="p-5 lg:col-span-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
          dragging ? 'border-accent bg-accent-bg' : 'border-line',
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-surface-2">
          <FileSpreadsheet className="size-6 text-muted" aria-hidden />
        </span>
        <div>
          <p className="font-medium">Drop a CSV or Excel file here</p>
          <p className="mt-1 text-sm text-muted">Up to 100,000 rows or {formatBytes(IMPORT_MAX_BYTES)}</p>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60"
        >
          <Upload className="size-4" aria-hidden />
          {upload.isPending ? 'Uploading…' : 'Choose a file'}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label="Spreadsheet to import"
          onChange={(e) => {
            send(e.target.files?.[0]);
            e.target.value = ''; // lets the same file be chosen again
          }}
        />
      </div>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}

function RecentImports() {
  const { data: items, error, isPending } = useImports();

  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 font-semibold">Recent imports</h2>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <Alert>{error.message}</Alert>
        </div>
      ) : !items?.length ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No imports yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id}>
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
          ))}
        </ul>
      )}
    </Card>
  );
}
