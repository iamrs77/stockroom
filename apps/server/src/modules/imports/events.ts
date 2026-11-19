import type { ImportSummary } from '@stockroom/shared';
import type { Redis } from 'ioredis';
import type { Logger } from '@/logger';
import { withTimeout } from '@/redis';

type Listener = (summary: ImportSummary) => void;

/**
 * Import progress, from the worker to every browser watching.
 *
 * Workers publish each update to one Redis channel. Each API process holds a single subscription
 * to it and hands updates to the open server-sent-event streams for that import. One subscription
 * per process, not one per viewer, keeps connections well inside a free Redis plan's limit (~30).
 */
export class ImportEvents {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly channel: string;

  constructor(
    private readonly options: { prefix: string; logger: Logger; publisher?: Redis; subscriber?: Redis },
  ) {
    this.channel = `${options.prefix}:import-progress`;
    const { subscriber, logger } = options;
    if (subscriber) {
      // ioredis subscribes again by itself after a reconnect.
      subscriber.subscribe(this.channel).catch((err: Error) => logger.warn({ err: err.message }, 'Could not subscribe to import progress'));
      subscriber.on('message', (_channel, message) => {
        try {
          this.dispatch(JSON.parse(message) as ImportSummary);
        } catch (err) {
          logger.warn({ err }, 'Ignored a malformed import progress message');
        }
      });
    }
  }

  /** Best effort: progress is also readable from the database, so a lost message only delays the UI. */
  async publish(summary: ImportSummary) {
    if (!this.options.publisher) return;
    try {
      await withTimeout(this.options.publisher.publish(this.channel, JSON.stringify(summary)), 2000, 'Publishing progress');
    } catch (err) {
      this.options.logger.warn({ err: (err as Error).message, importId: summary.id }, 'Could not publish import progress');
    }
  }

  /** Calls the listener with each update for one import. Returns a function that stops listening. */
  listen(importId: string, listener: Listener): () => void {
    let set = this.listeners.get(importId);
    if (!set) this.listeners.set(importId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(importId);
    };
  }

  private dispatch(summary: ImportSummary) {
    for (const listener of this.listeners.get(summary.id) ?? []) listener(summary);
  }
}
