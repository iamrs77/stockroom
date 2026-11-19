import type { WebhookEventType } from '@stockroom/shared';

/** How each event a webhook can subscribe to is named in the settings. */
export const webhookEventLabels: Record<WebhookEventType, string> = {
  'stock.low': 'Stock low',
  'stock.restocked': 'Restocked',
  'transfer.sent': 'Transfer sent',
  'transfer.received': 'Transfer received',
  'transfer.cancelled': 'Transfer cancelled',
  'import.completed': 'Import finished',
  'import.failed': 'Import failed',
};
