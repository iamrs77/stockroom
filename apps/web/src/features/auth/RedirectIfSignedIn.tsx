import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { Spinner } from '@/components/ui';
import { useMe } from './auth-api';

/** For the sign-in and sign-up pages: signed-in users skip straight to the app. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { data: user, isPending } = useMe();
  if (isPending) return <Spinner />;
  if (user) return <Navigate to="/products" replace />;
  return children;
}
