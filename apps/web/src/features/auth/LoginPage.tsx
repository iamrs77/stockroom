import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { getFormErrors } from '@/api/form-errors';
import { usePublicConfig } from '@/api/public-config';
import { Alert, Button, Field, Input } from '@/components/ui';
import { TryDemoCard } from '@/features/demo/TryDemoCard';
import { useLogin } from './auth-api';
import { AuthLayout } from './AuthLayout';
import { useRedirectAfterSignIn } from './useRedirectAfterSignIn';

export function LoginPage() {
  const login = useLogin();
  const done = useRedirectAfterSignIn();
  const { data: config } = usePublicConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { fieldErrors, formError } = getFormErrors(login.error);

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password }, { onSuccess: done });
  }

  return (
    <AuthLayout
      title="Sign in"
      footer={
        config?.signupsEnabled !== false && (
          <>
            New here?{' '}
            <Link to="/register" className="font-medium text-accent hover:underline">
              Create an account
            </Link>
          </>
        )
      }
    >
      <TryDemoCard />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Field label="Email" error={fieldErrors.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" error={fieldErrors.password}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" loading={login.isPending} className="mt-1">
          Sign in
        </Button>
        {/* The fixed demo login only exists in local development (npm run db:seed). */}
        {import.meta.env.DEV && (
          <button
            type="button"
            className="text-sm text-muted hover:text-ink"
            onClick={() => {
              setEmail('demo@stockroom.app');
              setPassword('stockroom-demo');
            }}
          >
            Fill in the local demo account
          </button>
        )}
      </form>
    </AuthLayout>
  );
}
