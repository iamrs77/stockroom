import { formatTransferNumber, type TransferDetail } from '@stockroom/shared';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useCancelTransfer, useReceiveTransfer, useTransfer } from '../api/queries';
import { TransferStatusBadge } from '../components/TransferStatus';
import { Alert, Button, Card, cx, Input, PageHeader, Spinner } from '../components/ui';
import { formatDateTime, formatNumber } from '../lib/format';

export function TransferDetailPage() {
  const id = useParams().id!;
  const { data: transfer, error, isPending } = useTransfer(id);

  if (isPending) return <Spinner label="Loading transfer" />;
  if (error || !transfer) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert>{error?.message ?? 'Transfer not found'}</Alert>
        <Link to="/transfers" className="text-sm font-medium text-accent hover:underline">
          Back to transfers
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/transfers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Transfers
      </Link>
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
      <Timeline transfer={transfer} />
      {transfer.status === 'in_transit' ? <ReceiveForm transfer={transfer} /> : <Lines transfer={transfer} />}
    </>
  );
}

function Timeline({ transfer }: { transfer: TransferDetail }) {
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

function Lines({ transfer }: { transfer: TransferDetail }) {
  const received = transfer.status === 'received';
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Product</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Sent</th>
            {received && <th scope="col" className="px-4 py-2 text-right font-medium">Received</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {transfer.lines.map((l) => {
            const short = received && l.receivedQuantity !== null && l.receivedQuantity < l.quantity;
            return (
              <tr key={l.productId}>
                <td className="px-4 py-2.5">
                  <Link to={`/products/${l.productId}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                  <div className="font-mono text-xs text-muted">{l.sku}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                {received && (
                  <td className={cx('px-4 py-2.5 text-right tabular-nums', short && 'font-medium text-warn')}>
                    {formatNumber(l.receivedQuantity ?? 0)}
                    {short && <span className="ml-1 text-xs">({formatNumber(l.quantity - l.receivedQuantity!)} short)</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function ReceiveForm({ transfer }: { transfer: TransferDetail }) {
  const receive = useReceiveTransfer(transfer.id);
  const cancel = useCancelTransfer(transfer.id);
  const [counts, setCounts] = useState(() => Object.fromEntries(transfer.lines.map((l) => [l.productId, String(l.quantity)])));
  const [receiveKey] = useState(() => crypto.randomUUID());
  const [cancelKey] = useState(() => crypto.randomUUID());
  const errors = receive.error instanceof ApiError ? receive.error.fieldErrors() : {};
  const failure = receive.error ?? cancel.error;

  function submit() {
    receive.mutate({
      input: { lines: transfer.lines.map((l) => ({ productId: l.productId, receivedQuantity: Number(counts[l.productId]) })) },
      idempotencyKey: receiveKey,
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold">Receive at {transfer.toStore.name}</h2>
        <p className="text-sm text-muted">Count what arrived. Anything short is recorded on the transfer.</p>
      </div>
      {failure && !Object.keys(errors).length && (
        <div className="p-4 pb-0">
          <Alert>{failure.message}</Alert>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Product</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Sent</th>
            <th scope="col" className="w-32 px-4 py-2 text-right font-medium">Arrived</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          {transfer.lines.map((l, i) => {
            const error = errors[`lines.${i}.receivedQuantity`];
            return (
              <tr key={l.productId}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{l.name}</div>
                  <div className="font-mono text-xs text-muted">{l.sku}</div>
                  {error && <div className="text-sm text-danger">{error}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                <td className="px-4 py-2.5">
                  <div className="ml-auto w-24">
                    <Input
                      aria-label={`Arrived: ${l.name}`}
                      inputMode="numeric"
                      className="text-right"
                      value={counts[l.productId]}
                      aria-invalid={error ? true : undefined}
                      onChange={(e) => setCounts({ ...counts, [l.productId]: e.target.value })}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2 border-t border-line p-4">
        <Button onClick={submit} loading={receive.isPending}>
          Receive
        </Button>
        <Button
          variant="danger"
          loading={cancel.isPending}
          onClick={() => {
            if (window.confirm(`Cancel ${formatTransferNumber(transfer.number)}? The stock goes back to ${transfer.fromStore.name}.`)) {
              cancel.mutate(cancelKey);
            }
          }}
        >
          Cancel transfer
        </Button>
      </div>
    </Card>
  );
}
