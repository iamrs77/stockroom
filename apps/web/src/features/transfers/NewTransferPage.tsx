import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { getFormErrors } from '@/api/form-errors';
import { Alert, BackLink, Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { useStores } from '@/features/stores/stores-api';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { NewTransferLine, type TransferLineDraft } from './components/NewTransferLine';
import { ProductPicker } from './components/ProductPicker';
import { StoreSelect } from './components/StoreSelect';
import { useCreateTransfer } from './transfers-api';

export function NewTransferPage() {
  const navigate = useNavigate();
  const { data: stores } = useStores();
  const create = useCreateTransfer();
  const [fromStoreId, setFrom] = useState('');
  const [toStoreId, setTo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<TransferLineDraft[]>([]);
  // One key per intended transfer, so a retried submit can't send the stock twice.
  const idempotencyKey = useIdempotencyKey();
  const { fieldErrors, formError } = getFormErrors(create.error);

  // Start with the first two stores picked.
  useEffect(() => {
    if (stores && stores.length >= 2 && !fromStoreId) {
      setFrom(stores[0]!.id);
      setTo(stores[1]!.id);
    }
  }, [stores, fromStoreId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      {
        input: { fromStoreId, toStoreId, note: note || undefined, lines: lines.map((l) => ({ productId: l.product.id, quantity: Number(l.quantity) })) },
        idempotencyKey,
      },
      { onSuccess: (transfer) => navigate(`/transfers/${transfer.id}`, { replace: true }) },
    );
  }

  if (stores && stores.length < 2) {
    return (
      <>
        <PageHeader title="New transfer" />
        <Alert>You need at least two stores to transfer stock. Add another store first.</Alert>
      </>
    );
  }

  return (
    <>
      <BackLink to="/transfers">Transfers</BackLink>
      <PageHeader title="New transfer" description="Stock leaves the sending store as soon as you send it." />
      <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="From" error={fieldErrors.fromStoreId}>
            {(p) => <StoreSelect {...p} stores={stores} value={fromStoreId} onChange={setFrom} />}
          </Field>
          <Field label="To" error={fieldErrors.toStoreId}>
            {(p) => <StoreSelect {...p} stores={stores} value={toStoreId} onChange={setTo} />}
          </Field>
          <Field label="Note" hint="Optional" className="sm:col-span-2">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Weekend restock" />}
          </Field>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Products</h2>
          <ProductPicker
            exclude={lines.map((l) => l.product.id)}
            onPick={(product) => setLines([...lines, { product, quantity: '1' }])}
          />
          {fieldErrors.lines && <p className="mt-2 text-sm text-danger">{fieldErrors.lines}</p>}
          {lines.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-md border border-line">
              {lines.map((line, i) => (
                <NewTransferLine
                  key={line.product.id}
                  line={line}
                  fromStoreId={fromStoreId}
                  error={fieldErrors[`lines.${i}.quantity`] ?? fieldErrors[`lines.${i}.productId`]}
                  onChange={(quantity) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity } : l)))}
                  onRemove={() => setLines(lines.filter((_, j) => j !== i))}
                />
              ))}
            </ul>
          )}
        </Card>

        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending} disabled={lines.length === 0}>
            Send transfer
          </Button>
          <Button variant="secondary" onClick={() => navigate('/transfers')}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
