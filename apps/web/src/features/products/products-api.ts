import type { ProductCreateInput, ProductDetail, ProductListParams, ProductPage, ProductUpdateInput } from '@stockroom/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

export function useProducts(query: ProductListParams) {
  return useQuery({
    queryKey: queryKeys.products.list(query),
    queryFn: () => api<ProductPage>('/products', { query }),
    // Keep showing the current page while the next one loads, instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => api<ProductDetail>(`/products/${id}`),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductCreateInput) => api<ProductDetail>('/products', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
  });
}

export function useUpdateProduct(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductUpdateInput) => api<ProductDetail>(`/products/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (product) => {
      queryClient.setQueryData(queryKeys.products.detail(id), product);
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      // A new reorder point can open or clear a low-stock alert.
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
    },
  });
}

export function useArchiveProduct(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.products.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts }); // an archived product's alert is cleared
    },
  });
}
