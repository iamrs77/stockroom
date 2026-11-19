import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** A link that looks like the primary button, for actions that open a page, like "New product". */
export function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
    >
      {children}
    </Link>
  );
}
