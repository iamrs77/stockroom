import { Alert, Card, PageHeader, Spinner } from '@/components/ui';
import { useAlerts } from './alerts-api';
import { LowStockTable } from './components/LowStockTable';

export function LowStockPage() {
  const { data, error, isPending } = useAlerts();

  return (
    <>
      <PageHeader
        title="Low stock"
        description="Products at or below their reorder point, counting stock in all stores. They clear by themselves when stock comes back."
      />
      {error && <Alert>{error.message}</Alert>}
      <Card className="overflow-hidden">
        {isPending ? (
          <Spinner />
        ) : !data?.items.length ? (
          <p className="px-4 py-12 text-center text-sm text-muted">Nothing is low on stock.</p>
        ) : (
          <LowStockTable alerts={data.items} />
        )}
      </Card>
    </>
  );
}
