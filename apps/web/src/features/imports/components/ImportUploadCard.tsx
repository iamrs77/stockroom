import { IMPORT_MAX_BYTES } from '@stockroom/shared';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { usePublicConfig } from '@/api/public-config';
import { Alert, Card } from '@/components/ui';
import { useMe } from '@/features/auth/auth-api';
import { cx } from '@/lib/cx';
import { formatBytes, formatNumber } from '@/lib/format';
import { useUploadImport } from '../imports-api';

const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Drop a CSV or Excel file here, or choose one. Too-large files are refused before uploading. */
export function ImportUploadCard() {
  const { data: config } = usePublicConfig();
  // Demo businesses have a smaller row limit.
  const isDemo = !!useMe().data?.tenant.demoExpiresAt;
  const maxRows = (isDemo ? config?.demoImportMaxRows : config?.importMaxRows) ?? 100_000;
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
          <p className="mt-1 text-sm text-muted">
            Up to {formatNumber(maxRows)} rows{isDemo && ' in a demo business'} or {formatBytes(IMPORT_MAX_BYTES)}
          </p>
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
