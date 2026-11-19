import { isImportFinished, type ImportDetail, type ImportSummary, type ImportUploadResult } from '@stockroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

const anyRunning = (items: ImportSummary[] | undefined) => items?.some((i) => !isImportFinished(i.status)) ?? false;

export function useImports() {
  return useQuery({
    queryKey: queryKeys.imports.list,
    queryFn: async () => (await api<{ items: ImportSummary[] }>('/imports')).items,
    // Live updates arrive on the detail page; the list just checks in while anything is running.
    refetchInterval: (query) => (anyRunning(query.state.data) ? 3000 : false),
  });
}

export function useImport(id: string) {
  return useQuery({
    queryKey: queryKeys.imports.detail(id),
    queryFn: () => api<ImportDetail>(`/imports/${id}`),
    // A slow safety net in case the live stream is interrupted.
    refetchInterval: (query) => (query.state.data && !isImportFinished(query.state.data.status) ? 10_000 : false),
  });
}

/** Uploads a spreadsheet; the server answers straight away and processes it in the background. */
export function useUploadImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<ImportUploadResult>('/imports', { method: 'POST', rawBody: file, query: { fileName: file.name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.imports.list }),
  });
}
