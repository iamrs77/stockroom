import { Boxes, FileUp, LogOut, Package, Store } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useLogout, useMe } from '../api/queries';
import { cx } from './ui';

const nav = [
  { to: '/products', label: 'Products', icon: Package },
  { to: '/stores', label: 'Stores', icon: Store },
  { to: '/imports', label: 'Imports', icon: FileUp },
];

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

export function AppLayout() {
  const { data: user } = useMe();
  const logout = useLogout();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Logo />
          <nav aria-label="Main" className="flex gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cx(
                    'flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium',
                    isActive ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right text-sm leading-tight md:block">
              <div className="truncate font-medium">{user?.tenant.name}</div>
              <div className="truncate text-muted">{user?.name}</div>
            </div>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-ink"
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
