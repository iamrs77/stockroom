import { manualStockReasons, type StoreStock } from '@stockroom/shared';
import { useState, type FormEvent } from 'react';
import { getFormErrors } from '@/api/form-errors';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { formatNumber } from '@/lib/format';
import { useAdjustStock } from '../stock-api';
import { manualStockReasonLabels, type ManualStockReason } from '../stock-reasons';

type Props = { productId: string; store: StoreStock; onDone: () => void };

/** Add or remove stock at one store, with a reason and an optional note. */
export function StockAdjustForm({ productId, store, onDone }: Props) {
  const adjust = useAdjustStock(productId);
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<ManualStockReason>('received');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string>();
  const idempotencyKey = useIdempotencyKey();
  const { fieldErrors, formError } = getFormErrors(adjust.error);

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
      {formError && (
        <div className="sm:col-span-2">
          <Alert>{formError}</Alert>
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
        error={amountError ?? fieldErrors.delta}
        hint={amount ? `${formatNumber(store.quantity)} → ${formatNumber(after)} in this store` : undefined}
      >
        {(p) => <Input {...p} inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Reason" error={fieldErrors.reason}>
        {(p) => (
          <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as ManualStockReason)}>
            {manualStockReasons.map((r) => (
              <option key={r} value={r}>
                {manualStockReasonLabels[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Note" hint="Optional" className="sm:col-span-2" error={fieldErrors.note}>
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
