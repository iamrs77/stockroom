import type { ApiErrorBody, FieldIssue } from '@stockroom/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldIssue[];

  constructor(status: number, code: string, message: string, details: FieldIssue[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field errors keyed by field name, for showing next to form inputs. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]));
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
};

export async function api<T>(path: string, { method = 'GET', body, headers, query }: RequestOptions = {}): Promise<T> {
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
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
