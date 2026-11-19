import type { WebhookDelivery } from '@stockroom/shared';
import { cx } from '@/lib/cx';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useWebhookDeliveries } from '../webhooks-api';

const results: Record<WebhookDelivery['status'], { label: string; className: string }> = {
  succeeded: { label: 'Delivered', className: 'text-accent' },
  failed: { label: 'Gave up', className: 'text-danger' },
  pending: { label: 'Retrying', className: 'text-warn' },
};

/** An endpoint's recent deliveries: the event, how it went, how many tries it took and when. */
export function WebhookDeliveries({ endpointId }: { endpointId: string }) {
  const { data: deliveries } = useWebhookDeliveries(endpointId);

  if (!deliveries?.length) {
    return <p className="px-4 py-6 text-center text-sm text-muted">No deliveries yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-surface-2 text-left text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Event</th>
            <th scope="col" className="px-4 py-2 font-medium">Result</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Attempts</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2 font-mono text-xs">{d.eventType}</td>
              <td className="px-4 py-2">
                <span className={cx('font-medium', results[d.status].className)}>{results[d.status].label}</span>
                {d.lastStatusCode !== null && <span className="text-muted"> · HTTP {d.lastStatusCode}</span>}
                {d.lastError && d.status !== 'succeeded' && <div className="text-xs text-muted">{d.lastError}</div>}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{d.attempts}</td>
              <td className="px-4 py-2 text-right text-muted" title={formatDateTime(d.createdAt)}>
                {formatRelative(d.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
