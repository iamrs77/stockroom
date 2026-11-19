# 3. Idempotency keys for stock changes

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

A stock change is not safe to repeat: sending "+24 received" twice records 48. Repeats happen for ordinary reasons, like a mobile connection timing out after the server committed, a user double-clicking, or a client library retrying. The client can't tell "it failed" from "it worked but I never got the answer".

## Decision

Mutating endpoints accept an `Idempotency-Key` header, following the same approach as Stripe's API and the IETF draft standard for the header.

- The key is scoped to the tenant and stored with a hash of the method, URL and body.
- The first request claims the key with `INSERT … ON CONFLICT DO NOTHING`. Exactly one concurrent request can win the claim.
- When it finishes, its status code and body are stored before the response is sent, so a retry that arrives immediately after sees them.
- A retry with the same key and body gets the stored response, with an `Idempotent-Replayed: true` header.
- The same key with a different body gets 422. Reusing a key for different work is a client bug and should fail loudly.
- A retry while the first request is still running gets 409, and the client retries later.
- Server errors (5xx) release the key, so the client can retry them. Client errors (4xx) are stored, so the result for a key never changes.
- A key left "in progress" for over 60 seconds (the server crashed mid-request) can be taken over by a retry.

The web app creates one key per intended change, when the form opens, and reuses it for retries of that submission.

## Consequences

- Retries are safe without the client needing to know whether the first attempt reached the server.
- One extra write per request with a key, plus a table that needs pruning (a scheduled job will delete keys older than 24 hours).
- Replaying a stored 4xx means a sale rejected for insufficient stock stays rejected under the same key even after stock arrives. That's intended: a new attempt is a new intent and gets a new key.
