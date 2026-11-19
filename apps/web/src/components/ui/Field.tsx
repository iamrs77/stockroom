import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';

/** What Field passes to its control, so the label and message are announced with it. */
export type ControlProps = { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string };

/**
 * A label, a control and its error or hint, wired together for screen readers:
 * <Field label="Email" error={errors.email}>{(p) => <Input {...p} />}</Field>
 */
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
