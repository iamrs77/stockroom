import { z } from 'zod';

export const uuidSchema = z.uuid();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** A page read with a cursor (keyset pagination) instead of an offset. */
export type CursorPage<T> = {
  items: T[];
  nextCursor: number | null;
};

export type FieldIssue = { path: string; message: string };

/** The body of every error response from the API. */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: FieldIssue[];
  };
};
