import { LogOut } from 'lucide-react';
import { useLogout, useMe } from '@/features/auth/auth-api';

/** The business and person signed in, and the sign-out button, at the right of the header. */
export function CurrentUser() {
  const { data: user } = useMe();
  const logout = useLogout();

  return (
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
  );
}
