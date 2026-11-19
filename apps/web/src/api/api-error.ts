import type { FieldIssue } from '@stockroom/shared';

/** A failed API request: the HTTP status, the server's error code and message, and any field problems. */
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
