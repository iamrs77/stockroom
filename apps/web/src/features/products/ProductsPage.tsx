import type { ProductSortField } from '@stockroom/shared';
import { Plus } from 'lucide-react';
import { Alert, Card, LinkButton, PageHeader, Spinner } from '@/components/ui';
import { useIsOwner } from '@/features/auth/useIsOwner';
import { formatNumber } from '@/lib/format';
import { ProductFilters } from './components/ProductFilters';
import { ProductPagination } from './components/ProductPagination';
import { ProductTable } from './components/ProductTable';
import { useProducts } from './products-api';
import { useProductListParams } from './useProductListParams';

const PAGE_SIZE = 25;

export function ProductsPage() {
  const [list, setList] = useProductListParams();
  const isOwner = useIsOwner();
  const filtered = Boolean(list.q || list.lowStock);

  const { data, error, isPending, isPlaceholderData } = useProducts({
    q: list.q || undefined,
    // A numbered page only when there's no cursor (e.g. an old bookmarked link).
    page: list.after || list.before ? undefined : list.page,
    after: list.after,
    before: list.before,
    pageSize: PAGE_SIZE,
    sort: list.sort,
    dir: list.dir,
    lowStock: list.lowStock || undefined,
  });

  // Past 10,000 matches the server stops counting, so the total reads "10,000+".
  const totalText = data ? `${formatNumber(data.total)}${data.totalCapped ? '+' : ''}` : '';

  const toggleSort = (key: ProductSortField) =>
    setList({ sort: key, dir: list.sort === key && list.dir === 'asc' ? 'desc' : 'asc' });
  const goNext = () => data?.nextCursor && setList({ page: list.page + 1, after: data.nextCursor, before: undefined });
  const goPrevious = () =>
    list.page <= 2 || !data?.prevCursor
      ? setList({ page: 1, after: undefined, before: undefined })
      : setList({ page: list.page - 1, before: data.prevCursor, after: undefined });

  return (
    <>
      <PageHeader
        title="Products"
        // While new results load, the previous ones stay on screen (dimmed). Their total would be
        // wrong for the new filter, so it's hidden until the new results arrive.
        description={data && !isPlaceholderData ? `${totalText} ${list.lowStock ? 'low on stock' : 'products'}` : ' '}
        actions={
          isOwner && (
            <LinkButton to="/products/new">
              <Plus className="size-4" aria-hidden />
              New product
            </LinkButton>
          )
        }
      />

      <ProductFilters
        search={list.q}
        lowStock={list.lowStock}
        onSearch={(q) => setList({ q })}
        onLowStockChange={(lowStock) => setList({ lowStock })}
      />

      {error && <Alert>{error.message}</Alert>}

      <Card className="overflow-hidden">
        {isPending ? (
          <Spinner label="Loading products" />
        ) : data && data.items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">{filtered ? 'No products match' : 'No products yet'}</p>
            <p className="mt-1 text-sm text-muted">
              {filtered ? 'Try a different search or clear the filter.' : 'Add your first product to start tracking stock.'}
            </p>
          </div>
        ) : (
          <ProductTable
            products={data?.items ?? []}
            sort={list.sort}
            dir={list.dir}
            dimmed={isPlaceholderData}
            onSort={toggleSort}
          />
        )}
      </Card>

      {data && data.total > 0 && (
        <ProductPagination
          page={list.page}
          pageSize={PAGE_SIZE}
          data={data}
          totalText={totalText}
          onPrevious={goPrevious}
          onNext={goNext}
        />
      )}
    </>
  );
}
