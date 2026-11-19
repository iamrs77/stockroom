import type { Store, StoreInput } from '@stockroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

export function useStores() {
  return useQuery({
    queryKey: queryKeys.stores,
    queryFn: async () => (await api<{ items: Store[] }>('/stores')).items,
  });
}

export function useCreateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StoreInput) => api<Store>('/stores', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.stores }),
  });
}
