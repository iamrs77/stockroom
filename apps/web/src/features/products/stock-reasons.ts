import type { manualStockReasons, StockReason } from '@stockroom/shared';

/** The reasons a person can pick when changing stock by hand. */
export type ManualStockReason = (typeof manualStockReasons)[number];

/** How each kind of stock change reads in a product's history. */
export const stockReasonLabels: Record<StockReason, string> = {
  received: 'Received',
  sold: 'Sold',
  damaged: 'Damaged or lost',
  correction: 'Count correction',
  import: 'Bulk import',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
};

/** How the reasons read in the stock change form. */
export const manualStockReasonLabels: Record<ManualStockReason, string> = {
  received: 'Received a delivery',
  sold: 'Sold',
  damaged: 'Damaged or lost',
  correction: 'Count correction',
};
