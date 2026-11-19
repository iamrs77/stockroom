import type { PendingInvite } from '@stockroom/shared';
import { Button } from '@/components/ui';
import { formatRelative } from '@/lib/format';

/** An invite link that hasn't been used yet, and when it expires. */
export function PendingInviteRow({ invite, onCancel }: { invite: PendingInvite; onCancel: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-48 flex-1 text-muted">
        Invite link for a new {invite.role}, expires {formatRelative(invite.expiresAt)}
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel invite
      </Button>
    </li>
  );
}
