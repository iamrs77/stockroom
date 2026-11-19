import type { ApiErrorBody, FieldIssue } from '@stockroom/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: FieldIssue[];

  constructor(status: number, code: string, message: string, details?: FieldIssue[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'No such endpoint' } };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { code: 'internal', message: 'Something went wrong' } };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: { code: 'invalid_json', message: 'The request body is not valid JSON' } };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body = { error: { code: 'payload_too_large', message: 'The request body is too large' } };
  } else {
    req.log.error({ err }, 'Unhandled error');
  }

  res.status(status).json(body);
};
