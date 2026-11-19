import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useCreateProduct } from '../api/queries';
import { ProductForm } from '../components/ProductForm';
import { Card, PageHeader } from '../components/ui';

export function NewProductPage() {
  const create = useCreateProduct();
  const navigate = useNavigate();

  return (
    <>
      <Link to="/products" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Products
      </Link>
      <PageHeader title="New product" description="Stock starts at zero. Add stock from the product page." />
      <Card className="max-w-2xl p-6">
        <ProductForm
          submitLabel="Create product"
          pending={create.isPending}
          error={create.error}
          onSubmit={(input) =>
            create.mutate(input, { onSuccess: (product) => navigate(`/products/${product.id}`, { replace: true }) })
          }
          onCancel={() => navigate('/products')}
        />
      </Card>
    </>
  );
}
