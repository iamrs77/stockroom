// How numbers, money, dates and sizes are shown across the app.

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const number = new Intl.NumberFormat('en-CA');
const dateTime = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const formatMoney = (cents: number) => money.format(cents / 100);
export const formatNumber = (n: number) => number.format(n);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** "+5" or "-3", for stock changes. */
export const formatSigned = (n: number) => (n > 0 ? `+${formatNumber(n)}` : formatNumber(n));

/** "3 minutes ago", "in 2 days" or "just now". */
export function formatRelative(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "45s" or "2m 05s". */
export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
