import { useState, type FormEvent } from 'react';
import { getFormErrors } from '@/api/form-errors';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { useCreateStore } from '../stores-api';

export function NewStoreForm() {
  const create = useCreateStore();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const { fieldErrors, formError } = getFormErrors(create.error);

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
        {formError && <Alert>{formError}</Alert>}
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
