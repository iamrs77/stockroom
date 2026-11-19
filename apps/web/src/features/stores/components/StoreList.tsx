import { Alert, Card, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useStores } from '../stores-api';

/** The business's stores, each with its short code. */
export function StoreList() {
  const { data: stores, error, isPending } = useStores();

  return (
    <Card className="lg:col-span-3">
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <Alert>{error.message}</Alert>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {stores?.map((store) => (
            <li key={store.id} className="flex items-center gap-4 px-4 py-3">
              <span className="grid h-9 min-w-12 place-items-center rounded-md bg-surface-2 px-2 font-mono text-xs font-semibold">
                {store.code}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{store.name}</div>
                <div className="text-xs text-muted">Added {formatDateTime(store.createdAt)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
