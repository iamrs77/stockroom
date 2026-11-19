import type { TeamMember } from '@stockroom/shared';
import { Button } from '@/components/ui';

/** A person in the business, with their role. Anyone but yourself can be removed. */
export function TeamMemberRow({ member, onRemove }: { member: TeamMember; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-48 flex-1">
        <div className="font-medium">
          {member.name} {member.isYou && <span className="text-sm font-normal text-muted">(you)</span>}
        </div>
        <div className="text-sm text-muted">{member.email}</div>
      </div>
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium capitalize">{member.role}</span>
      {!member.isYou && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.confirm(`Remove ${member.name}? They'll be signed out straight away.`) && onRemove()}
        >
          Remove
        </Button>
      )}
    </li>
  );
}
