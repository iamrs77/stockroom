import type { LowStockAlert } from '@stockroom/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

/** Products currently low on stock. Also feeds the count on the "Low stock" link, so it refreshes every minute. */
export function useAlerts() {
  return useQuery({
    queryKey: queryKeys.alerts,
    queryFn: () => api<{ items: LowStockAlert[]; total: number }>('/alerts'),
    refetchInterval: 60_000,
  });
}
