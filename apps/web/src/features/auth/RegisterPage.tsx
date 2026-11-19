import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { getFormErrors } from '@/api/form-errors';
import { Alert, Button, Field, Input } from '@/components/ui';
import { TryDemoCard } from '@/features/demo/TryDemoCard';
import { useRegister } from './auth-api';
import { AuthLayout } from './AuthLayout';
import { useRedirectAfterSignIn } from './useRedirectAfterSignIn';

export function RegisterPage() {
  const register = useRegister();
  const done = useRedirectAfterSignIn();
  const [form, setForm] = useState({ businessName: '', name: '', email: '', password: '' });
  const { fieldErrors, formError } = getFormErrors(register.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function submit(event: FormEvent) {
    event.preventDefault();
    register.mutate(form, { onSuccess: done });
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <TryDemoCard />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Field label="Business name" error={fieldErrors.businessName}>
          {(p) => <Input {...p} autoComplete="organization" value={form.businessName} onChange={set('businessName')} />}
        </Field>
        <Field label="Your name" error={fieldErrors.name}>
          {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Password" error={fieldErrors.password} hint="At least 10 characters">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <Button type="submit" loading={register.isPending} className="mt-1">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
