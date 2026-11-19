import { createBrowserRouter, Navigate } from 'react-router';
import { LoginPage } from '@/features/auth/LoginPage';
import { RedirectIfSignedIn } from '@/features/auth/RedirectIfSignedIn';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { LowStockPage } from '@/features/alerts/LowStockPage';
import { ImportDetailPage } from '@/features/imports/ImportDetailPage';
import { ImportsPage } from '@/features/imports/ImportsPage';
import { NewProductPage } from '@/features/products/NewProductPage';
import { ProductDetailPage } from '@/features/products/ProductDetailPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { StoresPage } from '@/features/stores/StoresPage';
import { AcceptInvitePage } from '@/features/team/AcceptInvitePage';
import { NewTransferPage } from '@/features/transfers/NewTransferPage';
import { TransferDetailPage } from '@/features/transfers/TransferDetailPage';
import { TransfersPage } from '@/features/transfers/TransfersPage';
import { AppLayout } from './layout/AppLayout';
import { NotFoundPage } from './NotFoundPage';

/** Every page and its address. Pages inside AppLayout need a signed-in user. */
export const router = createBrowserRouter([
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
      { path: '/alerts', element: <LowStockPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
