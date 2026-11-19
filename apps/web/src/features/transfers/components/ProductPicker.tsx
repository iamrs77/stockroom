import type { ProductListItem } from '@stockroom/shared';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui';
import { useProducts } from '@/features/products/products-api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatNumber } from '@/lib/format';

type Props = {
  /** Products already on the transfer, left out of the results. */
  exclude: string[];
  onPick: (product: ProductListItem) => void;
};

/** A search box that lists matching products as you type; picking one adds it to the transfer. */
export function ProductPicker({ exclude, onPick }: Props) {
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), 250);
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
