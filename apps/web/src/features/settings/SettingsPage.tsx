import { PageHeader } from '@/components/ui';
import { TeamSection } from '@/features/team/components/TeamSection';
import { WebhooksSection } from '@/features/webhooks/components/WebhooksSection';

/** Owners only (the nav hides it from staff): the team, and where Stockroom sends events. */
export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Who can use Stockroom, and where it sends events." />
      <div className="grid gap-8">
        <TeamSection />
        <WebhooksSection />
      </div>
    </>
  );
}
