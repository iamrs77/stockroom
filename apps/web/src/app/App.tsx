import { QueryClientProvider } from '@tanstack/react-query';
// The DOM build of RouterProvider can apply navigations synchronously (flushSync) when asked.
import { RouterProvider } from 'react-router/dom';
import { queryClient } from './query-client';
import { router } from './router';

/** The whole app: server data (TanStack Query) and pages (React Router). */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
