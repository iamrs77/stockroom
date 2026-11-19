import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';

/** A read-only value with a Copy button, for things shown once like invite links and secrets. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input readOnly aria-label={label} value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
