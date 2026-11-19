export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 100_000;

export const importStatuses = ['queued', 'processing', 'completed', 'failed'] as const;
export type ImportStatus = (typeof importStatuses)[number];

export const isImportFinished = (status: ImportStatus) => status === 'completed' || status === 'failed';

export type ImportSummary = {
  id: string;
  fileName: string;
  fileSize: number;
  format: 'csv' | 'xlsx';
  status: ImportStatus;
  /** Data rows in the file, known once processing starts. */
  totalRows: number | null;
  /** Data rows committed so far. This is also the checkpoint processing resumes from. */
  processedRows: number;
  createdCount: number;
  updatedCount: number;
  stockChangeCount: number;
  /** Rows skipped because of a problem. */
  errorCount: number;
  failureReason: string | null;
  userName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ImportRowError = {
  rowNumber: number;
  sku: string | null;
  column: string | null;
  message: string;
};

export type ImportDetail = ImportSummary & {
  /** The first problems found; the full list is in the downloadable report. */
  errors: ImportRowError[];
};

export type ImportUploadResult = {
  import: ImportSummary;
  /** True when the same file was already queued or running, so no new import was created. */
  duplicate: boolean;
};
