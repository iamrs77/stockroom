import { manualStockReasons, type StoreStock } from '@stockroom/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAdjustStock } from '../api/queries';
import { formatNumber } from '../lib/format';
import { Alert, Button, Field, Input, Select } from './ui';

const reasonLabels: Record<(typeof manualStockReasons)[number], string> = {
  received: 'Received a delivery',
  sold: 'Sold',
  damaged: 'Damaged or lost',
  correction: 'Count correction',
};

export function StockAdjustForm({ productId, store, onDone }: { productId: string; store: StoreStock; onDone: () => void }) {
  const adjust = useAdjustStock(productId);
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<(typeof manualStockReasons)[number]>('received');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string>();
  // One key per intended change: retries of this submission reuse it, so the server applies it once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const serverErrors = adjust.error instanceof ApiError ? adjust.error.fieldErrors() : {};

  function chooseDirection(next: 'add' | 'remove') {
    setDirection(next);
    setReason(next === 'add' ? 'received' : 'sold');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const quantity = Number(amount);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setAmountError('Enter a whole number above 0');
      return;
    }
    setAmountError(undefined);
    const delta = direction === 'add' ? quantity : -quantity;
    adjust.mutate(
      { input: { storeId: store.storeId, delta, reason, note: note || undefined }, idempotencyKey },
      { onSuccess: onDone },
    );
  }

  const after = store.quantity + (direction === 'add' ? 1 : -1) * (Number(amount) || 0);

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-md border border-line bg-surface-2 p-4 sm:grid-cols-2" noValidate>
      {adjust.error && !Object.keys(serverErrors).length && (
        <div className="sm:col-span-2">
          <Alert>{adjust.error.message}</Alert>
        </div>
      )}
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium">Change at {store.storeName}</legend>
        <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
          {(['add', 'remove'] as const).map((option) => (
            <label
              key={option}
              className="cursor-pointer rounded px-3 py-1.5 text-sm has-[:checked]:bg-accent has-[:checked]:text-accent-ink"
            >
              <input
                type="radio"
                name="direction"
                className="sr-only"
                checked={direction === option}
                onChange={() => chooseDirection(option)}
              />
              {option === 'add' ? 'Add stock' : 'Remove stock'}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="Quantity"
        error={amountError ?? serverErrors.delta}
        hint={amount ? `${formatNumber(store.quantity)} → ${formatNumber(after)} in this store` : undefined}
      >
        {(p) => <Input {...p} inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Reason" error={serverErrors.reason}>
        {(p) => (
          <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            {manualStockReasons.map((r) => (
              <option key={r} value={r}>
                {reasonLabels[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Note" hint="Optional" className="sm:col-span-2" error={serverErrors.note}>
        {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. PO-1042" />}
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={adjust.isPending}>
          Save change
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export { reasonLabels };
