import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useCreateStore, useMe, useStores } from '../api/queries';
import { Alert, Button, Card, Field, Input, PageHeader, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';

export function StoresPage() {
  const { data: user } = useMe();
  const { data: stores, error, isPending } = useStores();

  return (
    <>
      <PageHeader title="Stores" description="Each store keeps its own stock of every product." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          {isPending ? (
            <Spinner />
          ) : error ? (
            <div className="p-4">
              <Alert>{error.message}</Alert>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {stores?.map((store) => (
                <li key={store.id} className="flex items-center gap-4 px-4 py-3">
                  <span className="grid h-9 min-w-12 place-items-center rounded-md bg-surface-2 px-2 font-mono text-xs font-semibold">
                    {store.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{store.name}</div>
                    <div className="text-xs text-muted">Added {formatDateTime(store.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {user?.role === 'owner' && <NewStoreForm />}
      </div>
    </>
  );
}

function NewStoreForm() {
  const create = useCreateStore();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const fieldErrors = create.error instanceof ApiError ? create.error.fieldErrors() : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { name, code },
      {
        onSuccess: () => {
          setName('');
          setCode('');
        },
      },
    );
  }

  return (
    <Card className="p-6 lg:col-span-2">
      <h2 className="mb-4 font-semibold">Add a store</h2>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {create.error && !Object.keys(fieldErrors).length && <Alert>{create.error.message}</Alert>}
        <Field label="Name" error={fieldErrors.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Queen Street West" />}
        </Field>
        <Field label="Short code" error={fieldErrors.code} hint="Shown on reports, e.g. QSW">
          {(p) => (
            <Input {...p} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" maxLength={12} />
          )}
        </Field>
        <Button type="submit" loading={create.isPending} className="self-start">
          Add store
        </Button>
      </form>
    </Card>
  );
}
