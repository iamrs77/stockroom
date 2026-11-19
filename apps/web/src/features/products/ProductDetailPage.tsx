import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Alert, BackLink, Button, Card, PageHeader, PageLoadError, Spinner } from '@/components/ui';
import { useIsOwner } from '@/features/auth/useIsOwner';
import { formatMoney } from '@/lib/format';
import { ProductForm } from './components/ProductForm';
import { StockByStore } from './components/StockByStore';
import { StockHistory } from './components/StockHistory';
import { useArchiveProduct, useProduct, useUpdateProduct } from './products-api';

export function ProductDetailPage() {
  const id = useParams().id!;
  const navigate = useNavigate();
  const { data: product, error, isPending } = useProduct(id);
  const update = useUpdateProduct(id);
  const archive = useArchiveProduct(id);
  const [editing, setEditing] = useState(false);
  const isOwner = useIsOwner();

  if (isPending) return <Spinner label="Loading product" />;
  if (error || !product) {
    return <PageLoadError message={error?.message ?? 'Product not found'} backTo="/products" backLabel="Back to products" />;
  }

  function confirmArchive() {
    if (!window.confirm(`Archive ${product!.name}? It will disappear from the product list, but its stock history is kept.`)) return;
    archive.mutate(undefined, { onSuccess: () => navigate('/products', { replace: true }) });
  }

  return (
    <>
      <BackLink to="/products">Products</BackLink>
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
          isOwner && !editing && (
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
        <StockByStore product={product} />
        <StockHistory productId={product.id} />
      </div>
    </>
  );
}
