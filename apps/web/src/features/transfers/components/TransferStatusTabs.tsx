import type { TransferStatus } from '@stockroom/shared';
import { cx } from '@/lib/cx';

const filters: { value: TransferStatus | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

type Props = { value: TransferStatus | undefined; onChange: (status: TransferStatus | undefined) => void };

/** The All / In transit / Received / Cancelled filter above the transfer list. */
export function TransferStatusTabs({ value, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Filter by status" className="mb-4 inline-flex rounded-md border border-line bg-surface p-0.5">
      {filters.map((f) => (
        <button
          key={f.label}
          type="button"
          role="tab"
          aria-selected={value === f.value}
          onClick={() => onChange(f.value)}
          className={cx('rounded px-3 py-1.5 text-sm', value === f.value ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:text-ink')}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
