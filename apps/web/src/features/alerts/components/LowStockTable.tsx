import type { LowStockAlert } from '@stockroom/shared';
import { Link } from 'react-router';
import { cx } from '@/lib/cx';
import { formatNumber, formatRelative } from '@/lib/format';

/** Each low product: its stock (red when none is left), its reorder point and how long it's been low. */
export function LowStockTable({ alerts }: { alerts: LowStockAlert[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">In stock</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Reorder at</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Low since</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {alerts.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-3">
                <Link to={`/products/${a.productId}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <div className="font-mono text-xs text-muted">{a.sku}</div>
              </td>
              <td className={cx('px-4 py-3 text-right font-semibold tabular-nums', a.stock === 0 ? 'text-danger' : 'text-warn')}>
                {formatNumber(a.stock)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.reorderPoint)}</td>
              <td className="px-4 py-3 text-right text-muted">{formatRelative(a.openedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
