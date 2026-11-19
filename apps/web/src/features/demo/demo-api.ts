import type { SessionUser } from '@stockroom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

/** Creates a private demo business for this visitor and signs them in to it. */
export function useStartDemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ user: SessionUser }>('/demo', { method: 'POST' }),
    onSuccess: ({ user }) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.config[0] });
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}
