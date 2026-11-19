import type {
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookEndpointCreateInput,
  WebhookEndpointUpdateInput,
} from '@stockroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

export function useWebhooks() {
  return useQuery({
    queryKey: queryKeys.webhooks.all,
    queryFn: async () => (await api<{ items: WebhookEndpoint[] }>('/webhooks')).items,
  });
}

/** Adds an endpoint. The response includes its signing secret, which is never shown again. */
export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookEndpointCreateInput) => api<WebhookEndpointCreated>('/webhooks', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all }),
  });
}

export function useUpdateWebhook(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookEndpointUpdateInput) => api<WebhookEndpoint>(`/webhooks/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all }),
  });
}

export function useDeleteWebhook(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all }),
  });
}

export function useSendTestWebhook(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ queued: boolean }>(`/webhooks/${id}/test`, { method: 'POST' }),
    // The delivery appears a moment later; refresh the log shortly after.
    onSuccess: () => setTimeout(() => void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all }), 1500),
  });
}

/** An endpoint's recent deliveries, refreshed every 2 seconds while any is still being retried. */
export function useWebhookDeliveries(id: string) {
  return useQuery({
    queryKey: queryKeys.webhooks.deliveries(id),
    queryFn: async () => (await api<{ items: WebhookDelivery[] }>(`/webhooks/${id}/deliveries`)).items,
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === 'pending') ? 2000 : false),
  });
}
