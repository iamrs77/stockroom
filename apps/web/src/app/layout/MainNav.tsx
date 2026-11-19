import { ArrowLeftRight, Bell, FileUp, Package, Settings, Store } from 'lucide-react';
import { NavLink } from 'react-router';
import { useAlerts } from '@/features/alerts/alerts-api';
import { useIsOwner } from '@/features/auth/useIsOwner';
import { cx } from '@/lib/cx';

/** The links across the header, with the number of low-stock products on "Low stock". */
export function MainNav() {
  const isOwner = useIsOwner();
  const { data: alerts } = useAlerts();

  const items = [
    { to: '/products', label: 'Products', icon: Package },
    { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
    { to: '/alerts', label: 'Low stock', icon: Bell, badge: alerts?.total },
    { to: '/imports', label: 'Imports', icon: FileUp },
    { to: '/stores', label: 'Stores', icon: Store },
    ...(isOwner ? [{ to: '/settings', label: 'Settings', icon: Settings }] : []),
  ];

  return (
    <nav aria-label="Main" className="-mx-1 flex min-w-0 gap-0.5 overflow-x-auto">
      {items.map(({ to, label, icon: Icon, badge }) => (
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
  );
}
