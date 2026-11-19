const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const number = new Intl.NumberFormat('en-CA');
const dateTime = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const formatMoney = (cents: number) => money.format(cents / 100);
export const formatNumber = (n: number) => number.format(n);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

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

export const formatSigned = (n: number) => (n > 0 ? `+${formatNumber(n)}` : formatNumber(n));

/** "12.50" → 1250. Returns NaN for anything that isn't a plain amount. */
export function parseMoney(value: string): number {
  const trimmed = value.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}

export type StockStatus = 'out' | 'low' | 'ok';

export function stockStatus(totalStock: number, reorderPoint: number): StockStatus {
  if (totalStock === 0) return 'out';
  if (reorderPoint > 0 && totalStock <= reorderPoint) return 'low';
  return 'ok';
}
