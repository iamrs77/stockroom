import type { ReactNode } from 'react';

/** An error message, announced to screen readers when it appears. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
      {children}
    </div>
  );
}
