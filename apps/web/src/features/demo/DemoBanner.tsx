/** The strip under the header in a demo business, saying how long until it's deleted. */
export function DemoBanner({ expiresAt }: { expiresAt: string }) {
  const hours = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));
  return (
    <div className="border-b border-accent/30 bg-accent-bg">
      <p className="mx-auto max-w-6xl px-4 py-2 text-sm">
        <span className="font-medium">This is your own demo business.</span>{' '}
        <span className="text-muted">
          Change anything: nobody else sees it, and it&rsquo;s deleted in {hours < 1 ? 'under an hour' : `about ${hours} hours`}.
        </span>
      </p>
    </div>
  );
}
