import type { WebhookEventType } from '@stockroom/shared';
import { useState, type FormEvent } from 'react';
import { getFormErrors } from '@/api/form-errors';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { useCreateWebhook } from '../webhooks-api';
import type { NewSecret } from './SigningSecretNotice';
import { WebhookEventPicker } from './WebhookEventPicker';

/** Adds an endpoint, subscribed to the stock events by default. Hands its one-time signing secret to `onCreated`. */
export function NewWebhookForm({ onCreated }: { onCreated: (secret: NewSecret) => void }) {
  const create = useCreateWebhook();
  const [url, setUrl] = useState('');
  const [types, setTypes] = useState<WebhookEventType[]>(['stock.low', 'stock.restocked']);
  const { fieldErrors, formError } = getFormErrors(create.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { url, eventTypes: types },
      {
        onSuccess: (created) => {
          onCreated({ url: created.url, secret: created.secret });
          setUrl('');
        },
      },
    );
  }

  return (
    <Card className="p-5">
      <h3 className="mb-3 font-semibold">Add an endpoint</h3>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Field label="URL" error={fieldErrors.url} hint="Must be https:// and reachable from the internet">
          {(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/stockroom-webhook" />}
        </Field>
        <WebhookEventPicker value={types} onChange={setTypes} error={fieldErrors.eventTypes} />
        <div>
          <Button type="submit" loading={create.isPending}>
            Add endpoint
          </Button>
        </div>
      </form>
    </Card>
  );
}
