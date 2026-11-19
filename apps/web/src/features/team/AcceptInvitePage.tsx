import { Link, useParams } from 'react-router';
import { Alert, Spinner } from '@/components/ui';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { AcceptInviteForm } from './components/AcceptInviteForm';
import { useInvitePreview } from './team-api';

/** Where an invite link leads: shows which business it's for, then creates the person's account. */
export function AcceptInvitePage() {
  const token = useParams().token!;
  const preview = useInvitePreview(token);

  return (
    <AuthLayout>
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
          <AcceptInviteForm token={token} />
        </>
      )}
    </AuthLayout>
  );
}
