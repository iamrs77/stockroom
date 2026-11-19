import type { InputHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import { controlClass } from './control-class';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClass, className)} {...props} />;
}
