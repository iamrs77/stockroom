import { Button, Card, CopyField } from '@/components/ui';

export type NewSecret = { url: string; secret: string };

/** A new endpoint's signing secret. The API returns it only once, so it stays up until dismissed. */
export function SigningSecretNotice({ secret, onDismiss }: { secret: NewSecret; onDismiss: () => void }) {
  return (
    <Card className="mb-4 grid gap-2 border-accent p-4">
      <p className="text-sm font-medium">Signing secret for {secret.url}. Copy it now: it won't be shown again.</p>
      <CopyField label="Signing secret" value={secret.secret} />
      <div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          I've saved it
        </Button>
      </div>
    </Card>
  );
}
