import { webhookEventTypes, type WebhookEndpoint, type WebhookEventType } from '@stockroom/shared';
import { Check, Copy, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  useCreateInvite,
  useCreateWebhook,
  useDeleteWebhook,
  useRemoveMember,
  useRevokeInvite,
  useSendTestWebhook,
  useTeam,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from '../api/queries';
import { Alert, Button, Card, cx, Field, Input, PageHeader, Spinner } from '../components/ui';
import { formatDateTime, formatRelative } from '../lib/format';

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Who can use Stockroom, and where it sends events." />
      <div className="grid gap-8">
        <TeamSection />
        <WebhooksSection />
      </div>
    </>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input readOnly aria-label={label} value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

// ---- Team ----

function TeamSection() {
  const { data: team, error, isPending } = useTeam();
  const createInvite = useCreateInvite();
  const revoke = useRevokeInvite();
  const remove = useRemoveMember();
  const [link, setLink] = useState<string>();

  return (
    <section aria-labelledby="team-heading">
      <h2 id="team-heading" className="mb-3 text-lg font-semibold">Team</h2>
      <Card className="overflow-hidden">
        {isPending ? (
          <Spinner />
        ) : error ? (
          <div className="p-4"><Alert>{error.message}</Alert></div>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {team?.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="font-medium">
                      {m.name} {m.isYou && <span className="text-sm font-normal text-muted">(you)</span>}
                    </div>
                    <div className="text-sm text-muted">{m.email}</div>
                  </div>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium capitalize">{m.role}</span>
                  {!m.isYou && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.confirm(`Remove ${m.name}? They'll be signed out straight away.`) && remove.mutate(m.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
              {team?.invites.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-48 flex-1 text-muted">
                    Invite link for a new {inv.role}, expires {formatRelative(inv.expiresAt)}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id)}>
                    Cancel invite
                  </Button>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 border-t border-line bg-surface-2 p-4">
              <p className="text-sm text-muted">
                Staff can view everything, change stock and handle transfers. Only owners can edit products, run imports or
                change settings.
              </p>
              {link ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Send this link to the person joining. It works once, for 7 days, and won't be shown again.</p>
                  <CopyField label="Invite link" value={link} />
                </div>
              ) : (
                <div>
                  <Button
                    loading={createInvite.isPending}
                    onClick={() =>
                      createInvite.mutate('staff', { onSuccess: ({ token }) => setLink(`${window.location.origin}/invite/${token}`) })
                    }
                  >
                    Create an invite link
                  </Button>
                </div>
              )}
              {(createInvite.error ?? remove.error ?? revoke.error) && <Alert>{(createInvite.error ?? remove.error ?? revoke.error)!.message}</Alert>}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

// ---- Webhooks ----

const eventLabels: Record<WebhookEventType, string> = {
  'stock.low': 'Stock low',
  'stock.restocked': 'Restocked',
  'transfer.sent': 'Transfer sent',
  'transfer.received': 'Transfer received',
  'transfer.cancelled': 'Transfer cancelled',
  'import.completed': 'Import finished',
  'import.failed': 'Import failed',
};

function WebhooksSection() {
  const { data: endpoints, error, isPending } = useWebhooks();
  const [secret, setSecret] = useState<{ url: string; secret: string }>();

  return (
    <section aria-labelledby="webhooks-heading">
      <h2 id="webhooks-heading" className="mb-1 text-lg font-semibold">Webhooks</h2>
      <p className="mb-3 text-sm text-muted">
        Stockroom sends a signed POST request to your URL when something happens, and retries for about 20 minutes if your
        server doesn't answer. Check the <span className="font-mono">Stockroom-Signature</span> header with your signing secret.
      </p>
      {error && <Alert>{error.message}</Alert>}
      {secret && (
        <Card className="mb-4 grid gap-2 border-accent p-4">
          <p className="text-sm font-medium">Signing secret for {secret.url}. Copy it now: it won't be shown again.</p>
          <CopyField label="Signing secret" value={secret.secret} />
          <div>
            <Button variant="ghost" size="sm" onClick={() => setSecret(undefined)}>
              I've saved it
            </Button>
          </div>
        </Card>
      )}
      <div className="grid gap-4">
        {isPending ? <Spinner /> : endpoints?.map((e) => <EndpointCard key={e.id} endpoint={e} />)}
        <NewEndpointForm onCreated={setSecret} />
      </div>
    </section>
  );
}

function NewEndpointForm({ onCreated }: { onCreated: (s: { url: string; secret: string }) => void }) {
  const create = useCreateWebhook();
  const [url, setUrl] = useState('');
  const [types, setTypes] = useState<WebhookEventType[]>(['stock.low', 'stock.restocked']);
  const errors = create.error instanceof ApiError ? create.error.fieldErrors() : {};

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
        {create.error && !Object.keys(errors).length && <Alert>{create.error.message}</Alert>}
        <Field label="URL" error={errors.url} hint="Must be https:// and reachable from the internet">
          {(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/stockroom-webhook" />}
        </Field>
        <EventPicker value={types} onChange={setTypes} error={errors.eventTypes} />
        <div>
          <Button type="submit" loading={create.isPending}>
            Add endpoint
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EventPicker({ value, onChange, error }: { value: WebhookEventType[]; onChange: (v: WebhookEventType[]) => void; error?: string }) {
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
              {eventLabels[type]}
            </label>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

function EndpointCard({ endpoint }: { endpoint: WebhookEndpoint }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateWebhook(endpoint.id);
  const remove = useDeleteWebhook(endpoint.id);
  const test = useSendTestWebhook(endpoint.id);
  const { data: deliveries } = useWebhookDeliveries(endpoint.id, open);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-60 flex-1">
          <div className="break-all font-mono text-sm">{endpoint.url}</div>
          <div className="mt-0.5 text-xs text-muted">
            {endpoint.eventTypes.map((t) => eventLabels[t]).join(', ')}
            {endpoint.lastDelivery && (
              <>
                {' '}
                · last delivery {endpoint.lastDelivery.status} {formatRelative(endpoint.lastDelivery.at)}
              </>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-accent)]"
            checked={endpoint.enabled}
            onChange={(e) => update.mutate({ enabled: e.target.checked })}
          />
          On
        </label>
        <Button variant="secondary" size="sm" onClick={() => test.mutate(undefined, { onSuccess: () => setOpen(true) })} loading={test.isPending} disabled={!endpoint.enabled}>
          Send test
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide deliveries' : 'Deliveries'}
        </Button>
        <button
          type="button"
          aria-label={`Delete ${endpoint.url}`}
          className="rounded p-1.5 text-muted hover:bg-danger-bg hover:text-danger"
          onClick={() => window.confirm('Delete this endpoint? It stops receiving events.') && remove.mutate()}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {(test.error ?? update.error ?? remove.error) && (
        <div className="px-4 pb-3"><Alert>{(test.error ?? update.error ?? remove.error)!.message}</Alert></div>
      )}
      {open && (
        <div className="overflow-x-auto border-t border-line">
          {!deliveries?.length ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No deliveries yet.</p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-2 text-left text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Event</th>
                  <th scope="col" className="px-4 py-2 font-medium">Result</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Attempts</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-mono text-xs">{d.eventType}</td>
                    <td className="px-4 py-2">
                      <span className={cx('font-medium', d.status === 'succeeded' ? 'text-accent' : d.status === 'failed' ? 'text-danger' : 'text-warn')}>
                        {d.status === 'succeeded' ? 'Delivered' : d.status === 'failed' ? 'Gave up' : 'Retrying'}
                      </span>
                      {d.lastStatusCode !== null && <span className="text-muted"> · HTTP {d.lastStatusCode}</span>}
                      {d.lastError && d.status !== 'succeeded' && <div className="text-xs text-muted">{d.lastError}</div>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.attempts}</td>
                    <td className="px-4 py-2 text-right text-muted" title={formatDateTime(d.createdAt)}>
                      {formatRelative(d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
