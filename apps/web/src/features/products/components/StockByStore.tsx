import type { ProductDetail } from '@stockroom/shared';
import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { stockStatus } from '../stock-status';
import { StockAdjustForm } from './StockAdjustForm';
import { StockBadge } from './StockBadge';

/** A product's stock in each store, with the total, and an Adjust button that opens the stock form for one store. */
export function StockByStore({ product }: { product: ProductDetail }) {
  const [adjustingStore, setAdjustingStore] = useState<string | null>(null);

  return (
    <Card className="lg:col-span-3">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">Stock by store</h2>
        <div className="flex items-center gap-2 text-sm">
          <StockBadge status={stockStatus(product.totalStock, product.reorderPoint)} />
          <span className="text-muted">
            Total <span className="font-semibold text-ink tabular-nums">{formatNumber(product.totalStock)}</span>
            {product.reorderPoint > 0 && <> · reorder at {formatNumber(product.reorderPoint)}</>}
            {product.inTransit > 0 && <> · {formatNumber(product.inTransit)} in transit</>}
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
  );
}
