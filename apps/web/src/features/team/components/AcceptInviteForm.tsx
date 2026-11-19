import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { getFormErrors } from '@/api/form-errors';
import { Alert, Button, Field, Input } from '@/components/ui';
import { useAcceptInvite } from '../team-api';

/** Name, email and password for the person joining. On success they're signed in to the business. */
export function AcceptInviteForm({ token }: { token: string }) {
  const navigate = useNavigate();
  const accept = useAcceptInvite(token);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const { fieldErrors, formError } = getFormErrors(accept.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function submit(event: FormEvent) {
    event.preventDefault();
    accept.mutate(form, { onSuccess: () => navigate('/products', { replace: true }) });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {formError && <Alert>{formError}</Alert>}
      <Field label="Your name" error={fieldErrors.name}>
        {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set('name')} />}
      </Field>
      <Field label="Email" error={fieldErrors.email}>
        {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
      </Field>
      <Field label="Password" error={fieldErrors.password} hint="At least 10 characters">
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
      </Field>
      <Button type="submit" loading={accept.isPending} className="mt-1">
        Join
      </Button>
    </form>
  );
}
