import type { TransferDetail } from '@stockroom/shared';
import { formatDateTime } from '@/lib/format';

/** When the transfer was sent, and received or cancelled, and by whom. */
export function TransferTimeline({ transfer }: { transfer: TransferDetail }) {
  const steps = [
    { label: 'Sent', at: transfer.createdAt, by: transfer.createdBy },
    transfer.receivedAt && { label: 'Received', at: transfer.receivedAt, by: transfer.receivedBy },
    transfer.cancelledAt && { label: 'Cancelled, stock returned', at: transfer.cancelledAt, by: transfer.cancelledBy },
  ].filter(Boolean) as { label: string; at: string; by: string | null }[];

  return (
    <ol className="mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
      {steps.map((s) => (
        <li key={s.label}>
          <span className="font-medium">{s.label}</span>{' '}
          <span className="text-muted">
            {formatDateTime(s.at)}
            {s.by && <> by {s.by}</>}
          </span>
        </li>
      ))}
    </ol>
  );
}
