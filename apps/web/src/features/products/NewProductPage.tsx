import { useNavigate } from 'react-router';
import { BackLink, Card, PageHeader } from '@/components/ui';
import { ProductForm } from './components/ProductForm';
import { useCreateProduct } from './products-api';

export function NewProductPage() {
  const create = useCreateProduct();
  const navigate = useNavigate();

  return (
    <>
      <BackLink to="/products">Products</BackLink>
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
