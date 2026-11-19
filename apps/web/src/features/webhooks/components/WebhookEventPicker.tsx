import { webhookEventTypes, type WebhookEventType } from '@stockroom/shared';
import { cx } from '@/lib/cx';
import { webhookEventLabels } from '../webhook-event-labels';

/** A checkbox chip for each event an endpoint can subscribe to. */
export function WebhookEventPicker({
  value,
  onChange,
  error,
}: {
  value: WebhookEventType[];
  onChange: (value: WebhookEventType[]) => void;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Events</legend>
      <div className="flex flex-wrap gap-2">
        {webhookEventTypes.map((type) => {
          const on = value.includes(type);
          return (
            <label
              key={type}
              className={cx(
                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                on ? 'border-accent bg-accent-bg' : 'border-line',
              )}
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={on}
                onChange={() => onChange(on ? value.filter((t) => t !== type) : [...value, type])}
              />
              {webhookEventLabels[type]}
            </label>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
