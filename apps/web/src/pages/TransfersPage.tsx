import { formatTransferNumber, transferStatuses, type TransferStatus } from '@stockroom/shared';
import { ArrowRight, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useTransfers } from '../api/queries';
import { TransferStatusBadge } from '../components/TransferStatus';
import { Alert, Card, cx, PageHeader, Spinner } from '../components/ui';
import { formatNumber, formatRelative } from '../lib/format';

const filters: { value: TransferStatus | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function TransfersPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status = (transferStatuses as readonly string[]).includes(raw ?? '') ? (raw as TransferStatus) : undefined;
  const { data: items, error, isPending } = useTransfers(status);

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Move stock between stores. It leaves the sending store straight away and arrives when it's received."
        actions={
          <Link
            to="/transfers/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden />
            New transfer
          </Link>
        }
      />
      <div role="tablist" aria-label="Filter by status" className="mb-4 inline-flex rounded-md border border-line bg-surface p-0.5">
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            role="tab"
            aria-selected={status === f.value}
            onClick={() => setParams(f.value ? { status: f.value } : {}, { replace: true })}
            className={cx('rounded px-3 py-1.5 text-sm', status === f.value ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:text-ink')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <Alert>{error.message}</Alert>}
      <Card className="overflow-hidden">
        {isPending ? (
          <Spinner label="Loading transfers" />
        ) : !items?.length ? (
          <p className="px-4 py-12 text-center text-sm text-muted">{status ? 'No transfers with this status.' : 'No transfers yet.'}</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((t) => (
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
        )}
      </Card>
    </>
  );
}
