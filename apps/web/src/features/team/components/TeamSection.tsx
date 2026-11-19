import { Alert, Card, Spinner } from '@/components/ui';
import { useRemoveMember, useRevokeInvite, useTeam } from '../team-api';
import { InvitePanel } from './InvitePanel';
import { PendingInviteRow } from './PendingInviteRow';
import { TeamMemberRow } from './TeamMemberRow';

/** Settings › Team: everyone in the business, pending invites, and creating an invite link. */
export function TeamSection() {
  const { data: team, error, isPending } = useTeam();
  const revoke = useRevokeInvite();
  const remove = useRemoveMember();

  return (
    <section aria-labelledby="team-heading">
      <h2 id="team-heading" className="mb-3 text-lg font-semibold">Team</h2>
      <Card className="overflow-hidden">
        {isPending ? (
          <Spinner />
        ) : error ? (
          <div className="p-4"><Alert>{error.message}</Alert></div>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {team?.members.map((m) => (
                <TeamMemberRow key={m.id} member={m} onRemove={() => remove.mutate(m.id)} />
              ))}
              {team?.invites.map((inv) => (
                <PendingInviteRow key={inv.id} invite={inv} onCancel={() => revoke.mutate(inv.id)} />
              ))}
            </ul>
            <InvitePanel otherError={remove.error ?? revoke.error} />
          </>
        )}
      </Card>
    </section>
  );
}
