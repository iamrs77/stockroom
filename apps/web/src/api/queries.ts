import type {
  CursorPage,
  LoginInput,
  Page,
  ProductCreateInput,
  ProductDetail,
  ProductListItem,
  ProductListParams,
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
    queryFn: () => api<Page<ProductListItem>>('/products', { query }),
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
