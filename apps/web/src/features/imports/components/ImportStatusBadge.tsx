import type { ImportStatus } from '@stockroom/shared';
import { CircleCheck, CircleX, Clock, LoaderCircle } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui';
import { cx } from '@/lib/cx';

const statuses: Record<ImportStatus, { label: string; tone: BadgeTone; icon: typeof Clock }> = {
  queued: { label: 'Queued', tone: 'neutral', icon: Clock },
  processing: { label: 'Importing', tone: 'accent', icon: LoaderCircle },
  completed: { label: 'Done', tone: 'accent', icon: CircleCheck },
  failed: { label: 'Failed', tone: 'danger', icon: CircleX },
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const { label, tone, icon: Icon } = statuses[status];
  return (
    <Badge tone={tone}>
      <Icon className={cx('size-3.5', status === 'processing' && 'animate-spin')} aria-hidden />
      {label}
    </Badge>
  );
}
