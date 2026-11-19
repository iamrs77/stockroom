import { usePublicConfig } from '@/api/public-config';
import { Alert, Button } from '@/components/ui';
import { useRedirectAfterSignIn } from '@/features/auth/useRedirectAfterSignIn';
import { useStartDemo } from './demo-api';

/** "Try the demo" on the sign-in and sign-up pages: a private sample business for this visitor, no sign-up needed. */
export function TryDemoCard() {
  const { data: config } = usePublicConfig();
  const start = useStartDemo();
  const done = useRedirectAfterSignIn();
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
