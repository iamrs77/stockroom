import { z } from 'zod';

/** Events a webhook endpoint can subscribe to. */
export const webhookEventTypes = [
  'stock.low',
  'stock.restocked',
  'transfer.sent',
  'transfer.received',
  'transfer.cancelled',
  'import.completed',
  'import.failed',
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

/** Sent only by the "Send test event" button. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export const webhookEndpointCreateSchema = z.object({
  url: z.url({ message: 'Enter a full URL, starting with https://' }).max(2000),
  description: z.string().trim().max(200).optional(),
  eventTypes: z.array(z.enum(webhookEventTypes)).min(1, 'Choose at least one event').optional(),
});

export const webhookEndpointUpdateSchema = z
  .object({
    enabled: z.boolean(),
    description: z.string().trim().max(200).nullable(),
    eventTypes: z.array(z.enum(webhookEventTypes)).min(1, 'Choose at least one event'),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type WebhookEndpointCreateInput = z.input<typeof webhookEndpointCreateSchema>;
export type WebhookEndpointUpdateInput = z.input<typeof webhookEndpointUpdateSchema>;

export type WebhookDeliveryStatus = 'pending' | 'succeeded' | 'failed';

export type WebhookEndpoint = {
  id: string;
  url: string;
  description: string | null;
  eventTypes: WebhookEventType[];
  enabled: boolean;
  createdAt: string;
  lastDelivery: { status: WebhookDeliveryStatus; at: string } | null;
};

export type WebhookEndpointCreated = WebhookEndpoint & {
  /** Shown once, when the endpoint is created. */
  secret: string;
};

export type WebhookDelivery = {
  id: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

/** The JSON body of every webhook request. */
export type WebhookEvent<T = unknown> = {
  id: string;
  type: string;
  createdAt: string;
  data: T;
};
