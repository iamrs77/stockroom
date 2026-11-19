import { LoaderCircle } from 'lucide-react';
import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import type { StockStatus } from '../lib/format';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-ink hover:bg-surface-2',
        variant === 'danger' && 'border border-line bg-surface text-danger hover:bg-danger-bg',
        className,
      )}
      {...props}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const controlClass =
  'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted ' +
  'focus:outline-2 focus:-outline-offset-1 focus:outline-accent aria-[invalid=true]:border-danger';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(controlClass, 'pr-8', className)} {...props} />;
}

type ControlProps = { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string };

/** A label, a control and its error message, wired together for screen readers. */
export function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': message ? messageId : undefined })}
      {message && (
        <p id={messageId} className={cx('text-sm', error ? 'text-danger' : 'text-muted')}>
          {message}
        </p>
      )}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-lg border border-line bg-surface', className)}>{children}</section>;
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function StockBadge({ status }: { status: StockStatus }) {
  if (status === 'ok') return null;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'out' ? 'bg-danger-bg text-danger' : 'bg-warn-bg text-warn',
      )}
    >
      {status === 'out' ? 'Out of stock' : 'Low stock'}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export { cx };
