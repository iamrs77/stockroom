import { ArrowLeftRight, Bell, Boxes, FileUp, LogOut, Package, Settings, Store } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useAlerts, useLogout, useMe } from '../api/queries';
import { cx } from './ui';

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink">
        <Boxes className="size-4" aria-hidden />
      </span>
      Stockroom
    </span>
  );
}

/** True for owners. Staff don't see actions the API would refuse them. */
export function useIsOwner() {
  return useMe().data?.role === 'owner';
}

export function AppLayout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const { data: alerts } = useAlerts();
  const isOwner = user?.role === 'owner';

  const nav = [
    { to: '/products', label: 'Products', icon: Package },
    { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
    { to: '/alerts', label: 'Low stock', icon: Bell, badge: alerts?.total },
    { to: '/imports', label: 'Imports', icon: FileUp },
    { to: '/stores', label: 'Stores', icon: Store },
    ...(isOwner ? [{ to: '/settings', label: 'Settings', icon: Settings }] : []),
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Logo />
          <nav aria-label="Main" className="-mx-1 flex min-w-0 gap-0.5 overflow-x-auto">
            {nav.map(({ to, label, icon: Icon, badge }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={({ isActive }) =>
                  cx(
                    'flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium',
                    isActive ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden lg:inline">{label}</span>
                {!!badge && (
                  <span className="rounded-full bg-warn-bg px-1.5 text-xs font-semibold text-warn tabular-nums" aria-label={`${badge} low on stock`}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right text-sm leading-tight md:block">
              <div className="truncate font-medium">{user?.tenant.name}</div>
              <div className="truncate text-muted">
                {user?.name} · {user?.role === 'owner' ? 'Owner' : 'Staff'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-ink"
              title="Sign out"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
