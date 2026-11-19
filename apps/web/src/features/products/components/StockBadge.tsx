import { Badge } from '@/components/ui';
import type { StockStatus } from '../stock-status';

/** "Low stock" or "Out of stock"; nothing when stock is fine. */
export function StockBadge({ status }: { status: StockStatus }) {
  if (status === 'ok') return null;
  return <Badge tone={status === 'out' ? 'danger' : 'warn'}>{status === 'out' ? 'Out of stock' : 'Low stock'}</Badge>;
}
