import type { TransferStatus } from '@stockroom/shared';
import { cx } from './ui';

const styles: Record<TransferStatus, { label: string; className: string }> = {
  in_transit: { label: 'In transit', className: 'bg-warn-bg text-warn' },
  received: { label: 'Received', className: 'bg-accent-bg text-accent' },
  cancelled: { label: 'Cancelled', className: 'bg-surface-2 text-muted' },
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const { label, className } = styles[status];
  return <span className={cx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', className)}>{label}</span>;
}
