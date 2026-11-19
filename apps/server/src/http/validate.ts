import { uuidSchema } from '@stockroom/shared';
import type { z } from 'zod';
import { HttpError, notFound } from './errors';

/** Parses input with a schema, or throws a 400 that lists every invalid field. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(
      400,
      'validation_failed',
      'Some fields are invalid',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** Reads an id from the URL. A malformed id can't match anything, so it is a 404, not a 400. */
export function parseId(value: unknown, what: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw notFound(what);
  return result.data;
}
