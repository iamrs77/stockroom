import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../api/queries';
import { Alert, Spinner } from './ui';

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

/** For the sign-in and sign-up pages: signed-in users skip straight to the app. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { data: user, isPending } = useMe();
  if (isPending) return <Spinner />;
  if (user) return <Navigate to="/products" replace />;
  return children;
}
