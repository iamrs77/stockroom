export type StockStatus = 'out' | 'low' | 'ok';

/** Out of stock, low (at or below the reorder point), or fine. A reorder point of 0 turns "low" off. */
export function stockStatus(totalStock: number, reorderPoint: number): StockStatus {
  if (totalStock === 0) return 'out';
  if (reorderPoint > 0 && totalStock <= reorderPoint) return 'low';
  return 'ok';
}
