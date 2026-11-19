import { formatTransferNumber, type TransferSummary } from '@stockroom/shared';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { formatNumber, formatRelative } from '@/lib/format';
import { TransferStatusBadge } from './TransferStatusBadge';

/** Transfers, newest first: number, route, size, age and status. Each opens the transfer. */
export function TransferList({ transfers }: { transfers: TransferSummary[] }) {
  return (
    <ul className="divide-y divide-line">
      {transfers.map((t) => (
        <li key={t.id}>
          <Link to={`/transfers/${t.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 hover:bg-surface-2">
            <span className="w-20 font-mono text-sm font-medium">{formatTransferNumber(t.number)}</span>
            <span className="flex min-w-48 flex-1 items-center gap-2 text-sm">
              <span className="font-medium">{t.fromStore.name}</span>
              <ArrowRight className="size-4 text-muted" aria-label="to" />
              <span className="font-medium">{t.toStore.name}</span>
            </span>
            <span className="text-sm text-muted tabular-nums">
              {formatNumber(t.totalUnits)} units · {t.lineCount} {t.lineCount === 1 ? 'product' : 'products'}
            </span>
            <span className="w-28 text-right text-sm text-muted">{formatRelative(t.createdAt)}</span>
            <TransferStatusBadge status={t.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
