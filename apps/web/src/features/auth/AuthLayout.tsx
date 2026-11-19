import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { Card } from '@/components/ui';

/** The centred card used by the sign-in, sign-up and invite pages, with an optional line below it. */
export function AuthLayout({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm p-6">
        {title && <h1 className="mb-5 text-xl font-semibold tracking-tight">{title}</h1>}
        {children}
      </Card>
      {footer !== undefined && <p className="mt-6 text-sm text-muted">{footer}</p>}
    </div>
  );
}
