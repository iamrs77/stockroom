import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Alert, Spinner } from '@/components/ui';
import { useMe } from './auth-api';

/** Shows its children only to signed-in users; everyone else goes to the sign-in page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isPending, error } = useMe();
  const location = useLocation();

  if (isPending) return <Spinner />;
  if (error) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Alert>{error.message}</Alert>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}
