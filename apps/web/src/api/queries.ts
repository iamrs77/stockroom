import {
  isImportFinished,
  type AcceptInviteInput,
  type ImportDetail,
  type ImportSummary,
  type ImportUploadResult,
  type InviteCreated,
  type InvitePreview,
  type LowStockAlert,
  type Role,
  type Team,
  type TransferCreateInput,
  type TransferDetail,
  type TransferReceiveInput,
  type TransferStatus,
  type TransferSummary,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointCreated,
  type WebhookEndpointCreateInput,
  type WebhookEndpointUpdateInput,
} from '@stockroom/shared';
import type {
  CursorPage,
  LoginInput,
  ProductCreateInput,
  ProductDetail,
  ProductListParams,
  ProductPage,
  ProductUpdateInput,
  RegisterInput,
  SessionUser,
  StockAdjustmentInput,
  StockAdjustmentResult,
  StockMovement,
  Store,
  StoreInput,
} from '@stockroom/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './client';

export const keys = {
  me: ['me'] as const,
  stores: ['stores'] as const,
  products: ['products'] as const,
  productList: (query: ProductListParams) => ['products', 'list', query] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  movements: (id: string) => ['products', 'movements', id] as const,
};

// ---- Session ----

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    // null when nobody is signed in.
    queryFn: async () => (await api<{ user: SessionUser | null }>('/auth/me')).user,
    staleTime: Infinity,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<{ user: SessionUser }>('/auth/login', { method: 'POST', body: input }),
    onSuccess: ({ user }) => queryClient.setQueryData(keys.me, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api<{ user: SessionUser }>('/auth/register', { method: 'POST', body: input }),
    onSuccess: ({ user }) => queryClient.setQueryData(keys.me, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // Drop everything cached for this business before showing the sign-in page.
      queryClient.clear();
      queryClient.setQueryData(keys.me, null);
    },
  });
}

// ---- Stores ----

export function useStores() {
  return useQuery({
    queryKey: keys.stores,
    queryFn: async () => (await api<{ items: Store[] }>('/stores')).items,
  });
}

export function useCreateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StoreInput) => api<Store>('/stores', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.stores }),
  });
}

// ---- Products ----

export function useProducts(query: ProductListParams) {
  return useQuery({
    queryKey: keys.productList(query),
    queryFn: () => api<ProductPage>('/products', { query }),
    // Keep showing the current page while the next one loads, instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: keys.product(id),
    queryFn: () => api<ProductDetail>(`/products/${id}`),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductCreateInput) => api<ProductDetail>('/products', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.products }),
  });
}

export function useUpdateProduct(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductUpdateInput) => api<ProductDetail>(`/products/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (product) => {
      queryClient.setQueryData(keys.product(id), product);
      void queryClient.invalidateQueries({ queryKey: keys.products });
    },
  });
}

export function useArchiveProduct(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: keys.product(id) });
      void queryClient.invalidateQueries({ queryKey: keys.products });
    },
  });
}

export function useMovements(productId: string) {
  return useInfiniteQuery({
    queryKey: keys.movements(productId),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.products }),
  });
}

// ---- Imports ----

const importKeys = {
  all: ['imports'] as const,
  list: ['imports', 'list'] as const,
  detail: (id: string) => ['imports', 'detail', id] as const,
};

const anyActive = (items: ImportSummary[] | undefined) => items?.some((i) => !isImportFinished(i.status)) ?? false;

export function useImports() {
  return useQuery({
    queryKey: importKeys.list,
    queryFn: async () => (await api<{ items: ImportSummary[] }>('/imports')).items,
    // Live updates arrive on the detail page; the list just checks in while anything is running.
    refetchInterval: (query) => (anyActive(query.state.data) ? 3000 : false),
  });
}

export function useImport(id: string) {
  return useQuery({
    queryKey: importKeys.detail(id),
    queryFn: () => api<ImportDetail>(`/imports/${id}`),
    // A slow safety net in case the live stream is interrupted.
    refetchInterval: (query) => (query.state.data && !isImportFinished(query.state.data.status) ? 10_000 : false),
  });
}

export function useUploadImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<ImportUploadResult>('/imports', { method: 'POST', rawBody: file, query: { fileName: file.name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: importKeys.list }),
  });
}

/**
 * Follows an import's progress over server-sent events and writes each update into the query
 * cache, so every component showing this import updates together.
 */
export function useImportEvents(id: string, enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/imports/${id}/events`);
    source.onmessage = (event: MessageEvent<string>) => {
      const summary = JSON.parse(event.data) as ImportSummary;
      queryClient.setQueryData<ImportDetail>(importKeys.detail(id), (old) => (old ? { ...old, ...summary } : old));
      queryClient.setQueryData<ImportSummary[]>(importKeys.list, (old) => old?.map((i) => (i.id === id ? summary : i)));
      if (isImportFinished(summary.status)) {
        // Close before the server does, or EventSource would reconnect.
        source.close();
        void queryClient.invalidateQueries({ queryKey: importKeys.detail(id) }); // fetch the problem list
        void queryClient.invalidateQueries({ queryKey: keys.products });
      }
    };
    return () => source.close();
  }, [id, enabled, queryClient]);
}

// ---- Transfers ----

const transferKeys = {
  all: ['transfers'] as const,
  list: (status?: TransferStatus) => ['transfers', 'list', status ?? 'all'] as const,
  detail: (id: string) => ['transfers', 'detail', id] as const,
};

export function useTransfers(status?: TransferStatus) {
  return useQuery({
    queryKey: transferKeys.list(status),
    queryFn: async () => (await api<{ items: TransferSummary[] }>('/transfers', { query: { status } })).items,
  });
}

export function useTransfer(id: string) {
  return useQuery({ queryKey: transferKeys.detail(id), queryFn: () => api<TransferDetail>(`/transfers/${id}`) });
}

/** Stock moved: refresh transfers, products (stock and in-transit counts) and alerts. */
function useInvalidateStock() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: transferKeys.all }),
      queryClient.invalidateQueries({ queryKey: keys.products }),
      queryClient.invalidateQueries({ queryKey: alertKeys.all }),
    ]);
}

export function useCreateTransfer() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: TransferCreateInput; idempotencyKey: string }) =>
      api<TransferDetail>('/transfers', { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: invalidate,
  });
}

export function useReceiveTransfer(id: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: TransferReceiveInput; idempotencyKey: string }) =>
      api<TransferDetail>(`/transfers/${id}/receive`, { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: invalidate,
  });
}

export function useCancelTransfer(id: string) {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      api<TransferDetail>(`/transfers/${id}/cancel`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } }),
    onSuccess: invalidate,
  });
}

// ---- Alerts ----

const alertKeys = { all: ['alerts'] as const };

export function useAlerts() {
  return useQuery({
    queryKey: alertKeys.all,
    queryFn: () => api<{ items: LowStockAlert[]; total: number }>('/alerts'),
    refetchInterval: 60_000,
  });
}

// ---- Team ----

const teamKeys = { all: ['team'] as const };

export function useTeam() {
  return useQuery({ queryKey: teamKeys.all, queryFn: () => api<Team>('/team') });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) => api<InviteCreated>('/team/invites', { method: 'POST', body: { role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/team/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/team/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}

export function useInvitePreview(token: string) {
  return useQuery({ queryKey: ['invite', token], queryFn: () => api<InvitePreview>(`/invites/${token}`), retry: false });
}

export function useAcceptInvite(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptInviteInput) => api<{ user: SessionUser }>(`/invites/${token}/accept`, { method: 'POST', body: input }),
    onSuccess: ({ user }) => {
      // A different person is now signed in: drop cached data, but keep this invite's preview,
      // which would otherwise refetch and find the invite already used.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'invite' });
      queryClient.setQueryData(keys.me, user);
    },
  });
}

// ---- Webhooks ----

const webhookKeys = {
  all: ['webhooks'] as const,
  deliveries: (id: string) => ['webhooks', 'deliveries', id] as const,
};

export function useWebhooks() {
  return useQuery({
    queryKey: webhookKeys.all,
    queryFn: async () => (await api<{ items: WebhookEndpoint[] }>('/webhooks')).items,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookEndpointCreateInput) => api<WebhookEndpointCreated>('/webhooks', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhookKeys.all }),
  });
}

export function useUpdateWebhook(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookEndpointUpdateInput) => api<WebhookEndpoint>(`/webhooks/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhookKeys.all }),
  });
}

export function useDeleteWebhook(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhookKeys.all }),
  });
}

export function useSendTestWebhook(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ queued: boolean }>(`/webhooks/${id}/test`, { method: 'POST' }),
    // The delivery appears a moment later; refresh the log shortly after.
    onSuccess: () => setTimeout(() => void queryClient.invalidateQueries({ queryKey: webhookKeys.all }), 1500),
  });
}

export function useWebhookDeliveries(id: string, enabled: boolean) {
  return useQuery({
    queryKey: webhookKeys.deliveries(id),
    queryFn: async () => (await api<{ items: WebhookDelivery[] }>(`/webhooks/${id}/deliveries`)).items,
    enabled,
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === 'pending') ? 2000 : false),
  });
}
