import type { ProductListItem } from '@stockroom/shared';
import { Link, useNavigate } from 'react-router';
import { formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { stockStatus } from '../stock-status';
import { StockBadge } from './StockBadge';

/** One product in the list. The whole row opens the product; the name is also a real link for keyboards. */
export function ProductRow({ product }: { product: ProductListItem }) {
  const navigate = useNavigate();
  return (
    <tr onClick={() => navigate(`/products/${product.id}`)} className="cursor-pointer hover:bg-surface-2">
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
  );
}
