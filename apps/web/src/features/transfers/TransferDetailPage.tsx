import { formatTransferNumber } from '@stockroom/shared';
import { ArrowRight } from 'lucide-react';
import { useParams } from 'react-router';
import { BackLink, PageHeader, PageLoadError, Spinner } from '@/components/ui';
import { ReceiveTransferForm } from './components/ReceiveTransferForm';
import { TransferLinesTable } from './components/TransferLinesTable';
import { TransferStatusBadge } from './components/TransferStatusBadge';
import { TransferTimeline } from './components/TransferTimeline';
import { useTransfer } from './transfers-api';

export function TransferDetailPage() {
  const id = useParams().id!;
  const { data: transfer, error, isPending } = useTransfer(id);

  if (isPending) return <Spinner label="Loading transfer" />;
  if (error || !transfer) {
    return <PageLoadError message={error?.message ?? 'Transfer not found'} backTo="/transfers" backLabel="Back to transfers" />;
  }

  return (
    <>
      <BackLink to="/transfers">Transfers</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{formatTransferNumber(transfer.number)}</span>
            <TransferStatusBadge status={transfer.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {transfer.fromStore.name}
            <ArrowRight className="size-4" aria-label="to" />
            {transfer.toStore.name}
            {transfer.note && <span>· {transfer.note}</span>}
          </span>
        }
      />
      <TransferTimeline transfer={transfer} />
      {/* Until it's received, the receiving store counts what arrived; afterwards the lines show the result. */}
      {transfer.status === 'in_transit' ? <ReceiveTransferForm transfer={transfer} /> : <TransferLinesTable transfer={transfer} />}
    </>
  );
}
