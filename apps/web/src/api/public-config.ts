import type { PublicConfig } from '@stockroom/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { queryKeys } from './query-keys';

/** The server's public settings: whether sign-ups and the demo are on, and the import row limits. */
export function usePublicConfig() {
  return useQuery({ queryKey: queryKeys.config, queryFn: () => api<PublicConfig>('/config'), staleTime: Infinity });
}
