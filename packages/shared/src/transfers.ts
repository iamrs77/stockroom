import { z } from 'zod';

export const transferStatuses = ['in_transit', 'received', 'cancelled'] as const;
export type TransferStatus = (typeof transferStatuses)[number];

export const formatTransferNumber = (n: number) => `TR-${String(n).padStart(4, '0')}`;

export const transferCreateSchema = z
  .object({
    fromStoreId: z.uuid('Choose the store sending the stock'),
    toStoreId: z.uuid('Choose the store receiving the stock'),
    note: z.string().trim().max(500).optional(),
    lines: z
      .array(
        z.object({
          productId: z.uuid('Choose a product'),
          quantity: z.number().int('Use a whole number').min(1, 'Send at least 1').max(1_000_000),
        }),
      )
      .min(1, 'Add at least one product')
      .max(500, 'A transfer can have at most 500 products'),
  })
  .refine((v) => v.fromStoreId !== v.toStoreId, { path: ['toStoreId'], message: 'Choose a different store to send to' })
  .refine((v) => new Set(v.lines.map((l) => l.productId)).size === v.lines.length, {
    path: ['lines'],
    message: 'Each product can only be on a transfer once',
  });

export type TransferCreateInput = z.input<typeof transferCreateSchema>;

/** Receiving without lines means everything arrived as sent. */
export const transferReceiveSchema = z.object({
  lines: z
    .array(z.object({ productId: z.uuid(), receivedQuantity: z.number().int('Use a whole number').min(0, 'Cannot be negative') }))
    .optional(),
});

export type TransferReceiveInput = z.input<typeof transferReceiveSchema>;

export const transferListQuerySchema = z.object({
  status: z.enum(transferStatuses).optional(),
});

type StoreRef = { id: string; name: string; code: string };

export type TransferSummary = {
  id: string;
  number: number;
  status: TransferStatus;
  fromStore: StoreRef;
  toStore: StoreRef;
  lineCount: number;
  totalUnits: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
};

export type TransferLine = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  receivedQuantity: number | null;
};

export type TransferDetail = TransferSummary & {
  receivedBy: string | null;
  cancelledBy: string | null;
  lines: TransferLine[];
};
