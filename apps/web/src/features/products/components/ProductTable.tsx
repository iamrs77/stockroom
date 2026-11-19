import type { ProductListItem, ProductSortField } from '@stockroom/shared';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from '@/lib/cx';
import { ProductRow } from './ProductRow';

const columns: { key: ProductSortField; label: string; align?: 'right' }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Product' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'stock', label: 'In stock', align: 'right' },
  { key: 'updated', label: 'Updated', align: 'right' },
];

type Props = {
  products: ProductListItem[];
  sort: ProductSortField;
  dir: 'asc' | 'desc';
  /** Fades the table while the next results load. */
  dimmed: boolean;
  onSort: (field: ProductSortField) => void;
};

/** The product list as a table. Clicking a column heading sorts by it; clicking again reverses it. */
export function ProductTable({ products, sort, dir, dimmed, onSort }: Props) {
  return (
    <div className={cx('overflow-x-auto transition-opacity', dimmed && 'opacity-60')}>
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-muted">
          <tr>
            {columns.map((col) => {
              const active = sort === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cx('px-4 py-2.5 font-medium', col.align === 'right' && 'text-right')}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}
                  >
                    {col.label}
                    {active &&
                      (dir === 'asc' ? (
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
          {products.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
