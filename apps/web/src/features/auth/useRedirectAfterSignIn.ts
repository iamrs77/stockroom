import { useLocation, useNavigate } from 'react-router';

/**
 * After signing in, go back to the page the visitor was trying to open (RequireAuth remembers it),
 * or to the product list.
 */
export function useRedirectAfterSignIn() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  return () => navigate(from ?? '/products', { replace: true });
}
