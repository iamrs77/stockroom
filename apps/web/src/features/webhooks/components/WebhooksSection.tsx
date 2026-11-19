import { useState } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { useWebhooks } from '../webhooks-api';
import { NewWebhookForm } from './NewWebhookForm';
import { SigningSecretNotice, type NewSecret } from './SigningSecretNotice';
import { WebhookCard } from './WebhookCard';

/** Settings › Webhooks: what they are, the business's endpoints, and a form to add one. */
export function WebhooksSection() {
  const { data: endpoints, error, isPending } = useWebhooks();
  // A new endpoint's secret, shown until the owner says they've saved it.
  const [secret, setSecret] = useState<NewSecret>();

  return (
    <section aria-labelledby="webhooks-heading">
      <h2 id="webhooks-heading" className="mb-1 text-lg font-semibold">Webhooks</h2>
      <p className="mb-3 text-sm text-muted">
        Stockroom sends a signed POST request to your URL when something happens, and retries for about 20 minutes if your
        server doesn't answer. Check the <span className="font-mono">Stockroom-Signature</span> header with your signing secret.
      </p>
      {error && <Alert>{error.message}</Alert>}
      {secret && <SigningSecretNotice secret={secret} onDismiss={() => setSecret(undefined)} />}
      <div className="grid gap-4">
        {isPending ? <Spinner /> : endpoints?.map((e) => <WebhookCard key={e.id} endpoint={e} />)}
        <NewWebhookForm onCreated={setSecret} />
      </div>
    </section>
  );
}
