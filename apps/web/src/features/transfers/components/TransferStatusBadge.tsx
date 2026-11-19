import type { TransferStatus } from '@stockroom/shared';
import { Badge, type BadgeTone } from '@/components/ui';

const statuses: Record<TransferStatus, { label: string; tone: BadgeTone }> = {
  in_transit: { label: 'In transit', tone: 'warn' },
  received: { label: 'Received', tone: 'accent' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const { label, tone } = statuses[status];
  return <Badge tone={tone}>{label}</Badge>;
}
