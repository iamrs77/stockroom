import type { ProductPage } from '@stockroom/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { formatNumber } from '@/lib/format';

type Props = {
  page: number;
  pageSize: number;
  data: ProductPage;
  /** The total, e.g. "1,204" or "10,000+" when the server stopped counting. */
  totalText: string;
  onPrevious: () => void;
  onNext: () => void;
};

/** "Showing 26–50 of 1,204" with Previous and Next buttons, under the product list. */
export function ProductPagination({ page, pageSize, data, totalText, onPrevious, onNext }: Props) {
  const pageCount = Math.max(1, Math.ceil(data.total / pageSize));
  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = (page - 1) * pageSize + data.items.length;

  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-4 text-sm text-muted">
      <span>
        Showing {formatNumber(firstRow)}–{formatNumber(lastRow)} of {totalText}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1 && !data.prevCursor} onClick={onPrevious}>
          <ChevronLeft className="size-4" aria-hidden />
          Previous
        </Button>
        <span className="tabular-nums">
          Page {formatNumber(page)}
          {!data.totalCapped && <> of {formatNumber(pageCount)}</>}
        </span>
        <Button variant="secondary" size="sm" disabled={!data.nextCursor} onClick={onNext}>
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
