/** "12.50" → 1250 cents. Returns NaN for anything that isn't a plain amount. */
export function parseMoney(value: string): number {
  const trimmed = value.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}
