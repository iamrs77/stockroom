import type { SelectHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import { controlClass } from './control-class';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(controlClass, 'pr-8', className)} {...props} />;
}
