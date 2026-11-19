import type { ImportSummary } from '@stockroom/shared';

/** How far through its rows an import is, 0 to 100. */
export function importPercent(summary: ImportSummary) {
  if (summary.status === 'completed') return 100;
  if (!summary.totalRows) return 0;
  return Math.min(100, Math.floor((summary.processedRows / summary.totalRows) * 100));
}
