import type { StockReason } from '@stockroom/shared';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useArchiveProduct, useMovements, useProduct, useUpdateProduct } from '../api/queries';
import { ProductForm } from '../components/ProductForm';
import { StockAdjustForm } from '../components/StockAdjustForm';
import { Alert, Button, Card, cx, PageHeader, Spinner, StockBadge } from '../components/ui';
import { formatDateTime, formatMoney, formatNumber, formatRelative, formatSigned, stockStatus } from '../lib/format';

const reasonText: Record<StockReason, string> = {
  received: 'Received',
  sold: 'Sold',
  damaged: 'Damaged or lost',
  correction: 'Count correction',
  import: 'Bulk import',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
};

export function ProductDetailPage() {
  const id = useParams().id!;
  const navigate = useNavigate();
  const { data: product, error, isPending } = useProduct(id);
  const update = useUpdateProduct(id);
  const archive = useArchiveProduct(id);
  const [editing, setEditing] = useState(false);
  const [adjustingStore, setAdjustingStore] = useState<string | null>(null);

  if (isPending) return <Spinner label="Loading product" />;
  if (error || !product) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert>{error?.message ?? 'Product not found'}</Alert>
        <Link to="/products" className="text-sm font-medium text-accent hover:underline">
          Back to products
        </Link>
      </div>
    );
  }

  function confirmArchive() {
    if (!window.confirm(`Archive ${product!.name}? It will disappear from the product list, but its stock history is kept.`)) return;
    archive.mutate(undefined, { onSuccess: () => navigate('/products', { replace: true }) });
  }

  return (
    <>
      <Link to="/products" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Products
      </Link>
      <PageHeader
        title={product.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{product.sku}</span>
            {product.category && <span>{product.category}</span>}
            <span>{formatMoney(product.priceCents)}</span>
          </span>
        }
        actions={
          !editing && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Button>
              <Button variant="danger" onClick={confirmArchive} loading={archive.isPending}>
                <Trash2 className="size-4" aria-hidden />
                Archive
              </Button>
            </>
          )
        }
      />

      {archive.error && (
        <div className="mb-4">
          <Alert>{archive.error.message}</Alert>
        </div>
      )}

      {editing && (
        <Card className="mb-6 p-6">
          <h2 className="mb-4 font-semibold">Edit product</h2>
          <ProductForm
            initial={product}
            submitLabel="Save changes"
            pending={update.isPending}
            error={update.error}
            onSubmit={(input) => update.mutate(input, { onSuccess: () => setEditing(false) })}
            onCancel={() => {
              update.reset();
              setEditing(false);
            }}
          />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">Stock by store</h2>
            <div className="flex items-center gap-2 text-sm">
              <StockBadge status={stockStatus(product.totalStock, product.reorderPoint)} />
              <span className="text-muted">
                Total <span className="font-semibold text-ink tabular-nums">{formatNumber(product.totalStock)}</span>
                {product.reorderPoint > 0 && <> · reorder at {formatNumber(product.reorderPoint)}</>}
              </span>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {product.stock.map((store) => (
              <li key={store.storeId} className="px-4 py-3">
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{store.storeName}</div>
                    <div className="font-mono text-xs text-muted">{store.storeCode}</div>
                  </div>
                  <div className="text-lg font-semibold tabular-nums">{formatNumber(store.quantity)}</div>
                  {adjustingStore !== store.storeId && (
                    <Button variant="secondary" size="sm" onClick={() => setAdjustingStore(store.storeId)}>
                      Adjust
                    </Button>
                  )}
                </div>
                {adjustingStore === store.storeId && (
                  <div className="mt-3">
                    <StockAdjustForm productId={product.id} store={store} onDone={() => setAdjustingStore(null)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <MovementHistory productId={product.id} />
      </div>
    </>
  );
}

function MovementHistory({ productId }: { productId: string }) {
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useMovements(productId);
  const movements = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card className="lg:col-span-2">
      <h2 className="border-b border-line px-4 py-3 font-semibold">History</h2>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <Alert>{error.message}</Alert>
        </div>
      ) : movements.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No stock changes yet.</p>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {movements.map((m) => (
              <li key={m.id} className="flex gap-3 px-4 py-3 text-sm">
                <span
                  className={cx(
                    'w-14 shrink-0 text-right font-semibold tabular-nums',
                    m.delta > 0 ? 'text-accent' : 'text-danger',
                  )}
                >
                  {formatSigned(m.delta)}
                </span>
                <div className="min-w-0 flex-1">
                  <div>
                    {reasonText[m.reason]} · <span className="text-muted">{m.storeName}</span>
                  </div>
                  {m.note && <div className="truncate text-muted">{m.note}</div>}
                  <div className="text-xs text-muted" title={formatDateTime(m.createdAt)}>
                    {formatRelative(m.createdAt)}
                    {m.userName && <> by {m.userName}</>} · balance {formatNumber(m.balanceAfter)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {hasNextPage && (
            <div className="border-t border-line p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} loading={isFetchingNextPage}>
                Show older changes
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
