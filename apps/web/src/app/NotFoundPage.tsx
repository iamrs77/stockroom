import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/products" className="text-sm font-medium text-accent hover:underline">
        Go to products
      </Link>
    </div>
  );
}
