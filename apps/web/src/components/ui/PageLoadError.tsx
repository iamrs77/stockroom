import { Link } from 'react-router';
import { Alert } from './Alert';

/** Shown in place of a detail page that couldn't be loaded, with a way back to the list. */
export function PageLoadError({ message, backTo, backLabel }: { message: string; backTo: string; backLabel: string }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Alert>{message}</Alert>
      <Link to={backTo} className="text-sm font-medium text-accent hover:underline">
        {backLabel}
      </Link>
    </div>
  );
}
