import type { WebhookEndpoint } from '@stockroom/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { webhookEventLabels } from '../webhook-event-labels';
import { useDeleteWebhook, useSendTestWebhook, useUpdateWebhook } from '../webhooks-api';
import { WebhookDeliveries } from './WebhookDeliveries';

/** One endpoint: its URL and events, an on/off switch, a test send, its delivery log and delete. */
export function WebhookCard({ endpoint }: { endpoint: WebhookEndpoint }) {
  const [showDeliveries, setShowDeliveries] = useState(false);
  const update = useUpdateWebhook(endpoint.id);
  const remove = useDeleteWebhook(endpoint.id);
  const test = useSendTestWebhook(endpoint.id);
  const error = test.error ?? update.error ?? remove.error;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-60 flex-1">
          <div className="break-all font-mono text-sm">{endpoint.url}</div>
          <div className="mt-0.5 text-xs text-muted">
            {endpoint.eventTypes.map((t) => webhookEventLabels[t]).join(', ')}
            {endpoint.lastDelivery && (
              <>
                {' '}
                · last delivery {endpoint.lastDelivery.status} {formatRelative(endpoint.lastDelivery.at)}
              </>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-accent)]"
            checked={endpoint.enabled}
            onChange={(e) => update.mutate({ enabled: e.target.checked })}
          />
          On
        </label>
        <Button
          variant="secondary"
          size="sm"
          // Open the log so the test delivery can be watched arriving.
          onClick={() => test.mutate(undefined, { onSuccess: () => setShowDeliveries(true) })}
          loading={test.isPending}
          disabled={!endpoint.enabled}
        >
          Send test
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowDeliveries(!showDeliveries)} aria-expanded={showDeliveries}>
          {showDeliveries ? 'Hide deliveries' : 'Deliveries'}
        </Button>
        <button
          type="button"
          aria-label={`Delete ${endpoint.url}`}
          className="rounded p-1.5 text-muted hover:bg-danger-bg hover:text-danger"
          onClick={() => window.confirm('Delete this endpoint? It stops receiving events.') && remove.mutate()}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {error && (
        <div className="px-4 pb-3"><Alert>{error.message}</Alert></div>
      )}
      {showDeliveries && (
        <div className="border-t border-line">
          <WebhookDeliveries endpointId={endpoint.id} />
        </div>
      )}
    </Card>
  );
}
