import { transferStatuses, type TransferStatus } from '@stockroom/shared';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Alert, Card, LinkButton, PageHeader, Spinner } from '@/components/ui';
import { TransferList } from './components/TransferList';
import { TransferStatusTabs } from './components/TransferStatusTabs';
import { useTransfers } from './transfers-api';

export function TransfersPage() {
  // The status filter lives in the URL, so a filtered list can be bookmarked.
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
          <LinkButton to="/transfers/new">
            <Plus className="size-4" aria-hidden />
            New transfer
          </LinkButton>
        }
      />
      <TransferStatusTabs value={status} onChange={(next) => setParams(next ? { status: next } : {}, { replace: true })} />

      {error && <Alert>{error.message}</Alert>}
      <Card className="overflow-hidden">
        {isPending ? (
          <Spinner label="Loading transfers" />
        ) : !items?.length ? (
          <p className="px-4 py-12 text-center text-sm text-muted">{status ? 'No transfers with this status.' : 'No transfers yet.'}</p>
        ) : (
          <TransferList transfers={items} />
        )}
      </Card>
    </>
  );
}
