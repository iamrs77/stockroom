import type { ProductListItem } from '@stockroom/shared';
import { X } from 'lucide-react';
import { Input } from '@/components/ui';
import { useProduct } from '@/features/products/products-api';
import { formatNumber } from '@/lib/format';

/** A product added to a new transfer, with the quantity as typed. */
export type TransferLineDraft = { product: Pick<ProductListItem, 'id' | 'sku' | 'name'>; quantity: string };

type Props = {
  line: TransferLineDraft;
  fromStoreId: string;
  error?: string;
  onChange: (quantity: string) => void;
  onRemove: () => void;
};

/** One product on a new transfer: how many are available at the sending store, the quantity, and Remove. */
export function NewTransferLine({ line, fromStoreId, error, onChange, onRemove }: Props) {
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
