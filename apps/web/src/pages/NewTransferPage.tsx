import type { ProductListItem } from '@stockroom/shared';
import { ArrowLeft, Search, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useCreateTransfer, useProduct, useProducts, useStores } from '../api/queries';
import { Alert, Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import { formatNumber } from '../lib/format';

type Line = { product: Pick<ProductListItem, 'id' | 'sku' | 'name'>; quantity: string };

export function NewTransferPage() {
  const navigate = useNavigate();
  const { data: stores } = useStores();
  const create = useCreateTransfer();
  const [fromStoreId, setFrom] = useState('');
  const [toStoreId, setTo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  // One key per intended transfer, so a retried submit can't send the stock twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (stores && stores.length >= 2 && !fromStoreId) {
      setFrom(stores[0]!.id);
      setTo(stores[1]!.id);
    }
  }, [stores, fromStoreId]);

  const errors = create.error instanceof ApiError ? create.error.fieldErrors() : {};
  const generalError = create.error && !Object.keys(errors).length ? create.error.message : undefined;

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
      <Link to="/transfers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Transfers
      </Link>
      <PageHeader title="New transfer" description="Stock leaves the sending store as soon as you send it." />
      <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
        {generalError && <Alert>{generalError}</Alert>}
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="From" error={errors.fromStoreId}>
            {(p) => (
              <Select {...p} value={fromStoreId} onChange={(e) => setFrom(e.target.value)}>
                {stores?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="To" error={errors.toStoreId}>
            {(p) => (
              <Select {...p} value={toStoreId} onChange={(e) => setTo(e.target.value)}>
                {stores?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Note" hint="Optional" className="sm:col-span-2">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Weekend restock" />}
          </Field>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Products</h2>
          <ProductSearch
            exclude={lines.map((l) => l.product.id)}
            onPick={(product) => setLines([...lines, { product, quantity: '1' }])}
          />
          {errors.lines && <p className="mt-2 text-sm text-danger">{errors.lines}</p>}
          {lines.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-md border border-line">
              {lines.map((line, i) => (
                <LineRow
                  key={line.product.id}
                  line={line}
                  fromStoreId={fromStoreId}
                  error={errors[`lines.${i}.quantity`] ?? errors[`lines.${i}.productId`]}
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

function LineRow({
  line,
  fromStoreId,
  error,
  onChange,
  onRemove,
}: {
  line: Line;
  fromStoreId: string;
  error?: string;
  onChange: (quantity: string) => void;
  onRemove: () => void;
}) {
  const { data: detail } = useProduct(line.product.id);
  const available = detail?.stock.find((s) => s.storeId === fromStoreId)?.quantity;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="min-w-40 flex-1">
        <div className="text-sm font-medium">{line.product.name}</div>
        <div className="font-mono text-xs text-muted">
          {line.product.sku}
          {available !== undefined && <span className="ml-2 font-sans">{formatNumber(available)} available</span>}
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
      </div>
      {/* Input is always full width, so a wrapper sets its size. */}
      <div className="w-24 shrink-0">
        <Input
          aria-label={`Quantity of ${line.product.name}`}
          inputMode="numeric"
          className="text-right"
          value={line.quantity}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <button type="button" onClick={onRemove} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Remove ${line.product.name}`}>
        <X className="size-4" />
      </button>
    </li>
  );
}

function ProductSearch({ exclude, onPick }: { exclude: string[]; onPick: (p: ProductListItem) => void }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const { data } = useProducts({ q: query || undefined, pageSize: 8, sort: 'name' });
  const results = query ? (data?.items ?? []).filter((p) => !exclude.includes(p.id)) : [];

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
      <Input
        type="search"
        aria-label="Find a product to add"
        placeholder="Find a product by name or SKU"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="pl-9"
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  onPick(p);
                  setText('');
                }}
              >
                <span>
                  {p.name} <span className="font-mono text-xs text-muted">{p.sku}</span>
                </span>
                <span className="text-xs text-muted tabular-nums">{formatNumber(p.totalStock)} in all stores</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
