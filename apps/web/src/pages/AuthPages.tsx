import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useLogin, usePublicConfig, useRegister, useStartDemo } from '../api/queries';
import { Logo } from '../components/AppLayout';
import { Alert, Button, Card, Field, Input } from '../components/ui';

function AuthShell({ title, footer, children }: { title: string; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-5 text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </Card>
      <p className="mt-6 text-sm text-muted">{footer}</p>
    </div>
  );
}

function useAfterAuth() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  return () => navigate(from ?? '/products', { replace: true });
}

/** "Try the demo": a private sample business for this visitor, no sign-up needed. */
function TryDemo() {
  const { data: config } = usePublicConfig();
  const start = useStartDemo();
  const done = useAfterAuth();
  if (!config?.demoEnabled) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent-bg p-4">
      <div>
        <p className="font-medium">Look around first?</p>
        <p className="text-sm text-muted">
          Get your own sample business with three stores and 136 products. No sign-up. It&rsquo;s yours for{' '}
          {config.demoHours} hours.
        </p>
      </div>
      {start.error && <Alert>{start.error.message}</Alert>}
      <Button onClick={() => start.mutate(undefined, { onSuccess: done })} loading={start.isPending}>
        Try the demo
      </Button>
    </div>
  );
}

export function LoginPage() {
  const login = useLogin();
  const done = useAfterAuth();
  const { data: config } = usePublicConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const fieldErrors = login.error instanceof ApiError ? login.error.fieldErrors() : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password }, { onSuccess: done });
  }

  return (
    <AuthShell
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
      <TryDemo />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {login.error && !Object.keys(fieldErrors).length && <Alert>{login.error.message}</Alert>}
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
    </AuthShell>
  );
}

export function RegisterPage() {
  const register = useRegister();
  const done = useAfterAuth();
  const [form, setForm] = useState({ businessName: '', name: '', email: '', password: '' });
  const fieldErrors = register.error instanceof ApiError ? register.error.fieldErrors() : {};
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function submit(event: FormEvent) {
    event.preventDefault();
    register.mutate(form, { onSuccess: done });
  }

  return (
    <AuthShell
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
      <TryDemo />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {register.error && !Object.keys(fieldErrors).length && <Alert>{register.error.message}</Alert>}
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
    </AuthShell>
  );
}
