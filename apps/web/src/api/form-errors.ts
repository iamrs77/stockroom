import { ApiError } from './api-error';

/**
 * Splits a failed request's error for a form. Problems with particular fields go next to those inputs;
 * anything else becomes one message for the whole form.
 */
export function getFormErrors(error: Error | null | undefined): { fieldErrors: Record<string, string>; formError?: string } {
  const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
  const formError = error && Object.keys(fieldErrors).length === 0 ? error.message : undefined;
  return { fieldErrors, formError };
}
