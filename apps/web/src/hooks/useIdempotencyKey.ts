import { useState } from 'react';

/**
 * A key for one intended change, sent as the Idempotency-Key header. It stays the same for as long as the
 * form is on screen, so resubmitting after a timeout can't apply the same change twice.
 */
export function useIdempotencyKey() {
  const [key] = useState(() => crypto.randomUUID());
  return key;
}
