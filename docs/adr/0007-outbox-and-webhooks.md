# 7. Events through a transactional outbox, delivered as signed webhooks

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Businesses want to hear about things as they happen: stock running low, a transfer arriving, an import finishing. These notifications leave the system, as HTTP requests to a URL the business chooses.

The obvious approach is to send the request (or push to a queue) right after the database change. It fails in two ways:

- **The change commits, then the process dies** before sending. The event is lost.
- **The message is sent, then the transaction rolls back.** The receiver hears about something that never happened.

There's no transaction that covers both Postgres and a remote HTTP server or Redis.

## Decision

### Write events in the same transaction as the change

Every change that matters inserts a row into `outbox_events` **inside its own transaction**: a stock change, a transfer, an import's completion. If the transaction commits, the event exists. If it rolls back, so does the event. The tests check both cases.

Low-stock alerts work the same way. `syncLowStockAlerts` compares current stock with each product's reorder point and opens or resolves alerts in one SQL statement. Alerts are unique per product while open, so a product hovering around its reorder point can't raise a flood of them. Each alert opened or resolved writes a `stock.low` or `stock.restocked` event.

### A relay fans events out; a worker sends them

- **The relay** takes a batch of unpublished events with `FOR UPDATE SKIP LOCKED`, creates one `webhook_deliveries` row per subscribed endpoint, and marks the events published, all in one transaction. Several relays can run at once without waiting on each other or sending anything twice: a delivery is unique per (endpoint, event).
- **The delivery worker** (BullMQ) sends each delivery and records every attempt. Failures retry with exponential backoff, 8 attempts over about 20 minutes, and then the delivery is marked failed. A sweeper re-queues deliveries the queue lost: the same "Postgres records, the queue delivers" pattern as imports ([ADR 0006](0006-bulk-import-pipeline.md)).
- **An endpoint gets only events from after it was added.** Otherwise a new endpoint would receive whatever backlog the relay hadn't processed yet.

### Poked, not polled

The relay runs when it's told new events committed. In one process it's a direct call; when the API and worker run separately, the poke goes over Redis. A slow timer (every 30 s) catches anything missed, such as events from a process that crashed before poking. There's no tight polling loop, which matters on a free database that sleeps when idle.

### Delivery semantics

- **At least once.** A receiver may get an event twice, for example if it answered after the timeout. Every request carries a `Stockroom-Event-Id` for de-duplication.
- **Not ordered.** Retries can reorder events. Each event has `createdAt`, and the data in it describes state (stock now), not deltas.
- **Signed.** `Stockroom-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<body>">` with the endpoint's secret, in the same style as Stripe's. Receivers verify the HMAC and reject old timestamps to stop replays.

Verifying a signature in Node:

```js
const [t, v1] = header.split(',').map((part) => part.split('=')[1]);
const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
const valid = timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex')) && Date.now() / 1000 - Number(t) < 300;
```

### Don't let webhooks reach private networks

A webhook URL is chosen by a user, but the request is made by our server. Without care, someone could point it at `http://169.254.169.254/` (cloud credentials) or internal services: server-side request forgery.

- **When an endpoint is saved:** the URL must be `https`, have no credentials, and resolve only to public addresses. Loopback, private, link-local, CGNAT, multicast, reserved, IPv6 unique-local and IPv4-mapped forms are all rejected (Node's `net.BlockList`).
- **When connecting:** the same check runs again inside the HTTP client's DNS lookup, so a hostname can't pass at registration and then be re-pointed at a private address (DNS rebinding).
- **Redirects aren't followed**, and only a little of the response is read.
- Local development and tests allow private addresses with a setting that refuses to start in production.

## Consequences

- An event is never lost after a commit and never sent for a rolled-back change. Tested both ways.
- **Delivery is near-instant when poked**, and at worst about 30 s late after a crash.
- **Receivers must handle duplicates and ordering.** That's the honest contract for HTTP delivery, and it's documented on the settings page.
- **Two more tables to prune.** A janitor deletes published events after 7 days, which takes their delivery log with them. It also deletes idempotency keys after 24 hours and expired sessions, which ADRs 0003 and 0004 promised.
- **Secrets are stored readable**, because every delivery must be signed with them. They're shown once at creation and never returned by the API again.
