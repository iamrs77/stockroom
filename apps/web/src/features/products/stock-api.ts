import type { CursorPage, StockAdjustmentInput, StockAdjustmentResult, StockMovement } from '@stockroom/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

/** A product's stock history, newest first, ten entries at a time. */
export function useStockHistory(productId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.products.movements(productId),
    queryFn: ({ pageParam }) =>
      api<CursorPage<StockMovement>>(`/products/${productId}/movements`, { query: { before: pageParam, limit: 10 } }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Sends a stock change with an Idempotency-Key. The caller keeps the same key for retries of the
 * same change (e.g. after a timeout), so the server applies it at most once.
 */
export function useAdjustStock(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: StockAdjustmentInput; idempotencyKey: string }) =>
      api<StockAdjustmentResult>(`/products/${productId}/stock-adjustments`, {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    // A change can open or clear a low-stock alert.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.alerts }),
      ]),
  });
}
