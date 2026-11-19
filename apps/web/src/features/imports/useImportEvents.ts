import { isImportFinished, type ImportDetail, type ImportSummary } from '@stockroom/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/api/query-keys';

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
      queryClient.setQueryData<ImportDetail>(queryKeys.imports.detail(id), (old) => (old ? { ...old, ...summary } : old));
      queryClient.setQueryData<ImportSummary[]>(queryKeys.imports.list, (old) => old?.map((i) => (i.id === id ? summary : i)));
      if (isImportFinished(summary.status)) {
        // Close before the server does, or EventSource would reconnect.
        source.close();
        void queryClient.invalidateQueries({ queryKey: queryKeys.imports.detail(id) }); // fetch the problem list
        void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.alerts }); // imported stock can open or clear alerts
      }
    };
    return () => source.close();
  }, [id, enabled, queryClient]);
}
