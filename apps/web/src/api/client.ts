import type { ApiErrorBody } from '@stockroom/shared';
import { ApiError } from './api-error';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Sent as-is instead of as JSON, e.g. a file upload. */
  rawBody?: Blob;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
};

/**
 * Calls the Stockroom API with the session cookie and returns the JSON response.
 * Any failure, including a network error, is thrown as an ApiError with a message fit to show.
 */
export async function api<T>(path: string, { method = 'GET', body, rawBody, headers, query }: RequestOptions = {}): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const url = `/api${path}${search.size ? `?${search}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(rawBody && { 'Content-Type': 'application/octet-stream' }),
        ...headers,
      },
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, error?.code ?? 'unknown', error?.message ?? `Request failed (${res.status})`, error?.details);
  }
  return data as T;
}
