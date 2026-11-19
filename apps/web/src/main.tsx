import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Navigate } from 'react-router';
// The DOM build of RouterProvider can apply navigations synchronously (flushSync) when asked.
import { RouterProvider } from 'react-router/dom';
import { ApiError } from './api/client';
import { keys } from './api/queries';
import { AppLayout } from './components/AppLayout';
import { RedirectIfSignedIn, RequireAuth } from './components/RequireAuth';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { ImportDetailPage } from './pages/ImportDetailPage';
import { ImportsPage } from './pages/ImportsPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AlertsPage } from './pages/AlertsPage';
import { NewTransferPage } from './pages/NewTransferPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransferDetailPage } from './pages/TransferDetailPage';
import { TransfersPage } from './pages/TransfersPage';
import { NewProductPage } from './pages/NewProductPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { ProductsPage } from './pages/ProductsPage';
import { StoresPage } from './pages/StoresPage';
import './index.css';

const queryClient = new QueryClient({
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
  if (event.type === 'updated' && error instanceof ApiError && error.status === 401 && event.query.queryKey[0] !== 'me') {
    queryClient.setQueryData(keys.me, null);
  }
});

function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/products" className="text-sm font-medium text-accent hover:underline">
        Go to products
      </Link>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <RedirectIfSignedIn><LoginPage /></RedirectIfSignedIn> },
  { path: '/register', element: <RedirectIfSignedIn><RegisterPage /></RedirectIfSignedIn> },
  { path: '/invite/:token', element: <AcceptInvitePage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Navigate to="/products" replace /> },
      { path: '/products', element: <ProductsPage /> },
      { path: '/products/new', element: <NewProductPage /> },
      { path: '/products/:id', element: <ProductDetailPage /> },
      { path: '/stores', element: <StoresPage /> },
      { path: '/imports', element: <ImportsPage /> },
      { path: '/imports/:id', element: <ImportDetailPage /> },
      { path: '/transfers', element: <TransfersPage /> },
      { path: '/transfers/new', element: <NewTransferPage /> },
      { path: '/transfers/:id', element: <TransferDetailPage /> },
      { path: '/alerts', element: <AlertsPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
