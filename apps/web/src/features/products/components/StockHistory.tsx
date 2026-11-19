import { Alert, Button, Card, Spinner } from '@/components/ui';
import { cx } from '@/lib/cx';
import { formatDateTime, formatNumber, formatRelative, formatSigned } from '@/lib/format';
import { useStockHistory } from '../stock-api';
import { stockReasonLabels } from '../stock-reasons';

/** Every change to a product's stock, newest first, with who made it and the balance after it. */
export function StockHistory({ productId }: { productId: string }) {
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useStockHistory(productId);
  const movements = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card className="lg:col-span-2">
      <h2 className="border-b border-line px-4 py-3 font-semibold">History</h2>
      {isPending ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <Alert>{error.message}</Alert>
        </div>
      ) : movements.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No stock changes yet.</p>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {movements.map((m) => (
              <li key={m.id} className="flex gap-3 px-4 py-3 text-sm">
                <span
                  className={cx(
                    'w-14 shrink-0 text-right font-semibold tabular-nums',
                    m.delta > 0 ? 'text-accent' : 'text-danger',
                  )}
                >
                  {formatSigned(m.delta)}
                </span>
                <div className="min-w-0 flex-1">
                  <div>
                    {stockReasonLabels[m.reason]} · <span className="text-muted">{m.storeName}</span>
                  </div>
                  {m.note && <div className="truncate text-muted">{m.note}</div>}
                  <div className="text-xs text-muted" title={formatDateTime(m.createdAt)}>
                    {formatRelative(m.createdAt)}
                    {m.userName && <> by {m.userName}</>} · balance {formatNumber(m.balanceAfter)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {hasNextPage && (
            <div className="border-t border-line p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} loading={isFetchingNextPage}>
                Show older changes
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
