import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui';

type Props = {
  search: string;
  lowStock: boolean;
  onSearch: (search: string) => void;
  onLowStockChange: (lowStock: boolean) => void;
};

/** The search box and the "Low stock only" filter above the product list. */
export function ProductFilters({ search, lowStock, onSearch, onLowStockChange }: Props) {
  const [text, setText] = useState(search);
  // Search when typing pauses, not on every key. Only the typed text restarts the timer. onSearch is
  // called from the timer, not the effect itself: it updates the URL with flushSync, which React
  // can't do while it's running effects.
  useEffect(() => {
    if (text === search) return;
    const timer = setTimeout(() => onSearch(text), 300);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-60 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          type="search"
          aria-label="Search products"
          placeholder="Search by name, SKU or category"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="pl-9"
        />
      </div>
      <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm">
        <input
          type="checkbox"
          checked={lowStock}
          onChange={(e) => onLowStockChange(e.target.checked)}
          className="size-4 accent-[var(--color-accent)]"
        />
        Low stock only
      </label>
    </div>
  );
}
