import type { TransferDetail } from '@stockroom/shared';
import { Link } from 'react-router';
import { Card } from '@/components/ui';
import { cx } from '@/lib/cx';
import { formatNumber } from '@/lib/format';

/** The products on a received or cancelled transfer, with what was sent and what arrived. */
export function TransferLinesTable({ transfer }: { transfer: TransferDetail }) {
  const received = transfer.status === 'received';
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Product</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Sent</th>
            {received && <th scope="col" className="px-4 py-2 text-right font-medium">Received</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {transfer.lines.map((l) => {
            const short = received && l.receivedQuantity !== null && l.receivedQuantity < l.quantity;
            return (
              <tr key={l.productId}>
                <td className="px-4 py-2.5">
                  <Link to={`/products/${l.productId}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                  <div className="font-mono text-xs text-muted">{l.sku}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                {received && (
                  <td className={cx('px-4 py-2.5 text-right tabular-nums', short && 'font-medium text-warn')}>
                    {formatNumber(l.receivedQuantity ?? 0)}
                    {short && <span className="ml-1 text-xs">({formatNumber(l.quantity - l.receivedQuantity!)} short)</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
