import { Outlet } from 'react-router';
import { Logo } from '@/components/Logo';
import { useMe } from '@/features/auth/auth-api';
import { DemoBanner } from '@/features/demo/DemoBanner';
import { CurrentUser } from './CurrentUser';
import { MainNav } from './MainNav';

/** The frame around every signed-in page: the header, the demo banner if any, and the page itself. */
export function AppLayout() {
  const { data: user } = useMe();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Logo />
          <MainNav />
          <CurrentUser />
        </div>
      </header>
      {user?.tenant.demoExpiresAt && <DemoBanner expiresAt={user.tenant.demoExpiresAt} />}
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
