export type LowStockAlert = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  /** Stock across all stores right now. */
  stock: number;
  reorderPoint: number;
  stockAtOpen: number;
  openedAt: string;
};
