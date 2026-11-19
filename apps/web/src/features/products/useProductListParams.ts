import { productSortFields, type ProductSortField } from '@stockroom/shared';
import { useSearchParams } from 'react-router';

export type ProductListState = {
  q: string;
  /** Only the number shown to the reader; pages are followed by cursor. */
  page: number;
  sort: ProductSortField;
  dir: 'asc' | 'desc';
  lowStock: boolean;
  after?: string;
  before?: string;
};

/**
 * The product list's search, filter, sort and page, kept in the URL so a filtered, sorted page can be
 * bookmarked or shared. Pages are followed by cursor (after/before), so a deep page is as fast as the first.
 */
export function useProductListParams() {
  const [params, setParams] = useSearchParams();
  const sortParam = params.get('sort');
  const state: ProductListState = {
    q: params.get('q') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
    sort: (productSortFields as readonly string[]).includes(sortParam ?? '') ? (sortParam as ProductSortField) : 'name',
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    lowStock: params.get('lowStock') === 'true',
    after: params.get('after') ?? undefined,
    before: params.get('before') ?? undefined,
  };

  const update = (changes: Partial<ProductListState>) => {
    // Anything but moving between pages starts again from the first page.
    const paging = 'page' in changes || 'after' in changes || 'before' in changes;
    const next = { ...state, ...(paging ? {} : { page: 1, after: undefined, before: undefined }), ...changes };
    const search = new URLSearchParams();
    if (next.q) search.set('q', next.q);
    if (next.page > 1) search.set('page', String(next.page));
    if (next.sort !== 'name') search.set('sort', next.sort);
    if (next.dir !== 'asc') search.set('dir', next.dir);
    if (next.lowStock) search.set('lowStock', 'true');
    if (next.after) search.set('after', next.after);
    if (next.before) search.set('before', next.before);
    // flushSync applies the change in the same frame, so controlled inputs like the checkbox don't flicker.
    setParams(search, { replace: true, flushSync: true });
  };

  return [state, update] as const;
}
