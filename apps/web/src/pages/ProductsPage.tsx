import { productSortFields, type ProductSortField } from '@stockroom/shared';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useProducts } from '../api/queries';
import { useIsOwner } from '../components/AppLayout';
import { Alert, Button, Card, cx, Input, PageHeader, Spinner, StockBadge } from '../components/ui';
import { formatMoney, formatNumber, formatRelative, stockStatus } from '../lib/format';

const PAGE_SIZE = 25;

const columns: { key: ProductSortField; label: string; align?: 'right' }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Product' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'stock', label: 'In stock', align: 'right' },
  { key: 'updated', label: 'Updated', align: 'right' },
];

/**
 * List state lives in the URL, so a filtered, sorted page can be bookmarked or shared. Pages are
 * followed by cursor (after/before), so a deep page is as fast as the first; `page` is only the
 * number shown to the reader.
 */
function useListParams() {
  const [params, setParams] = useSearchParams();
  const sortParam = params.get('sort');
  const state = {
    q: params.get('q') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
    sort: (productSortFields as readonly string[]).includes(sortParam ?? '') ? (sortParam as ProductSortField) : 'name',
    dir: params.get('dir') === 'desc' ? ('desc' as const) : ('asc' as const),
    lowStock: params.get('lowStock') === 'true',
    after: params.get('after') ?? undefined,
    before: params.get('before') ?? undefined,
  };
  const update = (changes: Partial<typeof state>) => {
    // Anything but moving between pages starts again from the first page.
    const paging = 'page' in changes || 'after' in changes || 'before' in changes;
    const next = { ...state, ...(paging ? {} : { page: 1, after: undefined, before: undefined }), ...changes };
    const search = new URLSearchParams();
    if (next.q) search.set('q', next.q);
    if (next.page > 1) search.set('page', String(next.page));
    if (next.sort !== 'name') search.set('sort', next.sort);
    if (next.dir !== 'asc') search.set('dir', next.dir);
    if (next.lowStock) search.set('lowStock', 'true');
    if (next.after) search.set('after', next.after);
    if (next.before) search.set('before', next.before);
    // flushSync applies the change in the same frame, so controlled inputs like the checkbox don't flicker.
    setParams(search, { replace: true, flushSync: true });
  };
  return [state, update] as const;
}

export function ProductsPage() {
  const [list, setList] = useListParams();
  const [search, setSearch] = useState(list.q);
  const navigate = useNavigate();
  const isOwner = useIsOwner();

  // Wait for a pause in typing before searching. Only the typed text should restart the timer.
  useEffect(() => {
    if (search === list.q) return;
    const timer = setTimeout(() => setList({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search]);

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
  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const firstRow = data && data.total > 0 ? (list.page - 1) * PAGE_SIZE + 1 : 0;
  const lastRow = data ? (list.page - 1) * PAGE_SIZE + data.items.length : 0;

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
        description={data && !isPlaceholderData ? `${totalText} ${list.lowStock ? 'low on stock' : 'products'}` : ' '}
        actions={
          isOwner && (
          <Link
            to="/products/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden />
            New product
          </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            aria-label="Search products"
            placeholder="Search by name, SKU or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm">
          <input
            type="checkbox"
            checked={list.lowStock}
            onChange={(e) => setList({ lowStock: e.target.checked })}
            className="size-4 accent-[var(--color-accent)]"
          />
          Low stock only
        </label>
      </div>

      {error && <Alert>{error.message}</Alert>}

      <Card className="overflow-hidden">
        {isPending ? (
          <Spinner label="Loading products" />
        ) : data && data.items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">{list.q || list.lowStock ? 'No products match' : 'No products yet'}</p>
            <p className="mt-1 text-sm text-muted">
              {list.q || list.lowStock ? 'Try a different search or clear the filter.' : 'Add your first product to start tracking stock.'}
            </p>
          </div>
        ) : (
          <div className={cx('overflow-x-auto transition-opacity', isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line bg-surface-2 text-left text-muted">
                <tr>
                  {columns.map((col) => {
                    const active = list.sort === col.key;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={active ? (list.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={cx('px-4 py-2.5 font-medium', col.align === 'right' && 'text-right')}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}
                        >
                          {col.label}
                          {active &&
                            (list.dir === 'asc' ? (
                              <ArrowUp className="size-3.5" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3.5" aria-hidden />
                            ))}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.items.map((product) => (
                  <tr
                    key={product.id}
                    onClick={() => navigate(`/products/${product.id}`)}
                    className="cursor-pointer hover:bg-surface-2"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted">{product.sku}</td>
                    <td className="px-4 py-3">
                      <Link to={`/products/${product.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {product.name}
                      </Link>
                      {product.category && <div className="text-xs text-muted">{product.category}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(product.priceCents)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <StockBadge status={stockStatus(product.totalStock, product.reorderPoint)} />
                        <span className="tabular-nums">{formatNumber(product.totalStock)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-muted">{formatRelative(product.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.total > 0 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-4 text-sm text-muted">
          <span>
            Showing {formatNumber(firstRow)}–{formatNumber(lastRow)} of {totalText}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={list.page <= 1 && !data?.prevCursor} onClick={goPrevious}>
              <ChevronLeft className="size-4" aria-hidden />
              Previous
            </Button>
            <span className="tabular-nums">
              Page {formatNumber(list.page)}
              {!data.totalCapped && <> of {formatNumber(pageCount)}</>}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!data?.nextCursor}
              onClick={goNext}
            >
              Next
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}
