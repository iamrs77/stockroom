import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useAcceptInvite, useInvitePreview } from '../api/queries';
import { Logo } from '../components/AppLayout';
import { Alert, Button, Card, Field, Input, Spinner } from '../components/ui';

export function AcceptInvitePage() {
  const token = useParams().token!;
  const navigate = useNavigate();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite(token);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const errors = accept.error instanceof ApiError ? accept.error.fieldErrors() : {};
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function submit(event: FormEvent) {
    event.preventDefault();
    accept.mutate(form, { onSuccess: () => navigate('/products', { replace: true }) });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm p-6">
        {preview.isPending ? (
          <Spinner />
        ) : preview.error ? (
          <div className="grid gap-4">
            <h1 className="text-xl font-semibold tracking-tight">This invite can't be used</h1>
            <Alert>{preview.error.message}</Alert>
            <Link to="/login" className="text-sm font-medium text-accent hover:underline">
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Join {preview.data.businessName}</h1>
            <p className="mt-1 mb-5 text-sm text-muted">You've been invited as {preview.data.role === 'owner' ? 'an owner' : 'staff'}.</p>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              {accept.error && !Object.keys(errors).length && <Alert>{accept.error.message}</Alert>}
              <Field label="Your name" error={errors.name}>
                {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set('name')} />}
              </Field>
              <Field label="Email" error={errors.email}>
                {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
              </Field>
              <Field label="Password" error={errors.password} hint="At least 10 characters">
                {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
              </Field>
              <Button type="submit" loading={accept.isPending} className="mt-1">
                Join
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
