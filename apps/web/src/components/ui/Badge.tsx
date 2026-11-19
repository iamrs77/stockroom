import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

const tones = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-bg text-accent',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
};

export type BadgeTone = keyof typeof tones;

/** A small rounded label for a status, like "Low stock" or "In transit". */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
  );
}
