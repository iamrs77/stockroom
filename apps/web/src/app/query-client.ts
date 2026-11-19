import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/api-error';
import { queryKeys } from '@/api/query-keys';

/** The cache for everything loaded from the API, shared by the whole app. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Don't retry what can't succeed by retrying.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

// A 401 from any request means the session ended (expired or signed out elsewhere): show the sign-in page.
queryClient.getQueryCache().subscribe((event) => {
  const error = event.query.state.error;
  const isSessionQuery = event.query.queryKey[0] === queryKeys.me[0];
  if (event.type === 'updated' && error instanceof ApiError && error.status === 401 && !isSessionQuery) {
    queryClient.setQueryData(queryKeys.me, null);
  }
});
