import { useState } from 'react';
import { Alert, Button, CopyField } from '@/components/ui';
import { useCreateInvite } from '../team-api';

/**
 * Under the team list: what staff can do, and a button that creates a single-use invite link.
 * The link is shown once to copy. `otherError` is a failed remove or cancel from the list above.
 */
export function InvitePanel({ otherError }: { otherError: Error | null }) {
  const createInvite = useCreateInvite();
  const [link, setLink] = useState<string>();
  const error = createInvite.error ?? otherError;

  return (
    <div className="grid gap-3 border-t border-line bg-surface-2 p-4">
      <p className="text-sm text-muted">
        Staff can view everything, change stock and handle transfers. Only owners can edit products, run imports or
        change settings.
      </p>
      {link ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Send this link to the person joining. It works once, for 7 days, and won't be shown again.</p>
          <CopyField label="Invite link" value={link} />
        </div>
      ) : (
        <div>
          <Button
            loading={createInvite.isPending}
            onClick={() =>
              createInvite.mutate('staff', { onSuccess: ({ token }) => setLink(`${window.location.origin}/invite/${token}`) })
            }
          >
            Create an invite link
          </Button>
        </div>
      )}
      {error && <Alert>{error.message}</Alert>}
    </div>
  );
}
