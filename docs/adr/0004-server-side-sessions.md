# 4. Server-side sessions instead of JWTs

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The browser app and the API share one origin. Users need to sign out for real, and an owner should eventually be able to remove a staff member's access straight away.

A signed JWT can't be revoked before it expires without a server-side denylist. At that point it's a session lookup with extra steps, and a bigger cookie.

## Decision

Opaque, server-side sessions.

- On sign-in the server creates 32 random bytes, sends them in an `HttpOnly; SameSite=Lax; Secure` cookie, and stores only their SHA-256 hash in `sessions`.
- Each request looks the session up by hash, joined to the user and tenant. It's a primary-key lookup.
- Sessions last 14 days and are extended for active users, at most once a day, to avoid writing on every request.
- Sign-out deletes the row.

Sign-in and sign-up are rate-limited per IP address. The limiter's counters live in process memory, which is correct for the single free-tier instance.

## Consequences

- Sign-out and access removal take effect immediately.
- A stolen database dump contains no usable session tokens.
- Every authenticated request costs one indexed query. If that ever matters, sessions can be cached in Redis with a short TTL.
- **With more than one instance, the in-memory rate limiter undercounts** (each instance counts separately). Redis is available since phase 2, so the fix is a Redis store for the limiter. It isn't switched on yet: with a single instance it adds a network round trip to every sign-in for no benefit. Turning it on comes with running a second API instance.
