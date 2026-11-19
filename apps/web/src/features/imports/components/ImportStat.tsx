import { Card } from '@/components/ui';
import { cx } from '@/lib/cx';
import { formatNumber } from '@/lib/format';

/** One count from an import, like "New products 8,980". */
export function ImportStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', warn && 'text-warn')}>{formatNumber(value)}</div>
    </Card>
  );
}
