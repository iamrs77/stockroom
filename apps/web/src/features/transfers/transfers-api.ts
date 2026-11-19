import type { TransferCreateInput, TransferDetail, TransferReceiveInput, TransferStatus, TransferSummary } from '@stockroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

export function useTransfers(status?: TransferStatus) {
  return useQuery({
    queryKey: queryKeys.transfers.list(status),
    queryFn: async () => (await api<{ items: TransferSummary[] }>('/transfers', { query: { status } })).items,
  });
}

export function useTransfer(id: string) {
  return useQuery({ queryKey: queryKeys.transfers.detail(id), queryFn: () => api<TransferDetail>(`/transfers/${id}`) });
}

/** Stock moved: refresh transfers, products (stock and in-transit counts) and alerts. */
function useRefreshAfterStockMoved() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts }),
    ]);
}

export function useCreateTransfer() {
  const refresh = useRefreshAfterStockMoved();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: TransferCreateInput; idempotencyKey: string }) =>
      api<TransferDetail>('/transfers', { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: refresh,
  });
}

export function useReceiveTransfer(id: string) {
  const refresh = useRefreshAfterStockMoved();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: TransferReceiveInput; idempotencyKey: string }) =>
      api<TransferDetail>(`/transfers/${id}/receive`, { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: refresh,
  });
}

export function useCancelTransfer(id: string) {
  const refresh = useRefreshAfterStockMoved();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      api<TransferDetail>(`/transfers/${id}/cancel`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: refresh,
  });
}
