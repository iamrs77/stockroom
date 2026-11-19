import type { ProductListParams, TransferStatus } from '@stockroom/shared';

/**
 * Every cache key in one place. Features refresh each other's data (a transfer changes product stock and
 * alerts, an import changes products), so the keys are shared instead of private to each feature.
 */
export const queryKeys = {
  me: ['me'] as const,
  config: ['config'] as const,
  stores: ['stores'] as const,
  products: {
    all: ['products'] as const,
    list: (query: ProductListParams) => ['products', 'list', query] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    movements: (id: string) => ['products', 'movements', id] as const,
  },
  imports: {
    list: ['imports', 'list'] as const,
    detail: (id: string) => ['imports', 'detail', id] as const,
  },
  transfers: {
    all: ['transfers'] as const,
    list: (status?: TransferStatus) => ['transfers', 'list', status ?? 'all'] as const,
    detail: (id: string) => ['transfers', 'detail', id] as const,
  },
  alerts: ['alerts'] as const,
  team: ['team'] as const,
  invites: {
    all: ['invite'] as const,
    preview: (token: string) => ['invite', token] as const,
  },
  webhooks: {
    all: ['webhooks'] as const,
    deliveries: (id: string) => ['webhooks', 'deliveries', id] as const,
  },
};
