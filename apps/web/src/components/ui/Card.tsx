import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-lg border border-line bg-surface', className)}>{children}</section>;
}
