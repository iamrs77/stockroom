import { formatTransferNumber, type TransferDetail } from '@stockroom/shared';
import { useState } from 'react';
import { getFormErrors } from '@/api/form-errors';
import { Alert, Button, Card, Input } from '@/components/ui';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { formatNumber } from '@/lib/format';
import { useCancelTransfer, useReceiveTransfer } from '../transfers-api';

/** For a transfer in transit: count what arrived and receive it, or cancel it and return the stock. */
export function ReceiveTransferForm({ transfer }: { transfer: TransferDetail }) {
  const receive = useReceiveTransfer(transfer.id);
  const cancel = useCancelTransfer(transfer.id);
  // Starts at the quantity sent, so receiving everything is one click.
  const [counts, setCounts] = useState(() => Object.fromEntries(transfer.lines.map((l) => [l.productId, String(l.quantity)])));
  const receiveKey = useIdempotencyKey();
  const cancelKey = useIdempotencyKey();
  const { fieldErrors, formError } = getFormErrors(receive.error ?? cancel.error);

  function submit() {
    receive.mutate({
      input: { lines: transfer.lines.map((l) => ({ productId: l.productId, receivedQuantity: Number(counts[l.productId]) })) },
      idempotencyKey: receiveKey,
    });
  }

  function confirmCancel() {
    if (window.confirm(`Cancel ${formatTransferNumber(transfer.number)}? The stock goes back to ${transfer.fromStore.name}.`)) {
      cancel.mutate(cancelKey);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold">Receive at {transfer.toStore.name}</h2>
        <p className="text-sm text-muted">Count what arrived. Anything short is recorded on the transfer.</p>
      </div>
      {formError && (
        <div className="p-4 pb-0">
          <Alert>{formError}</Alert>
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
            const error = fieldErrors[`lines.${i}.receivedQuantity`];
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
        <Button variant="danger" loading={cancel.isPending} onClick={confirmCancel}>
          Cancel transfer
        </Button>
      </div>
    </Card>
  );
}
