import { Alert, Card, Spinner } from '@/components/ui';
import { useImports } from '../imports-api';
import { RecentImportRow } from './RecentImportRow';

/** The business's latest imports, with progress for running ones and results for finished ones. */
export function RecentImports() {
  const { data: items, error, isPending } = useImports();

  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 font-semibold">Recent imports</h2>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <Alert>{error.message}</Alert>
        </div>
      ) : !items?.length ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No imports yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <RecentImportRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}
