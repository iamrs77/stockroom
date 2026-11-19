import { z } from 'zod';

export const storeInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a store name').max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Enter a short code')
    .max(12, 'Use at most 12 characters')
    .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and dashes'),
});

export type StoreInput = z.input<typeof storeInputSchema>;

export type Store = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
};
