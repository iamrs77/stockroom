import { z } from 'zod';
import { paginationQuerySchema } from './common';

/** One SKU rule for the product form and for imports. */
export const skuSchema = z
  .string()
  .trim()
  .min(1, 'Enter a SKU')
  .max(64, 'Use at most 64 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letters, numbers, dots, dashes, slashes or underscores');

const productFields = {
  sku: skuSchema,
  name: z.string().trim().min(1, 'Enter a name').max(200),
  category: z.string().trim().max(100).nullable(),
  priceCents: z.number().int().min(0, 'Price cannot be negative').max(100_000_000),
  reorderPoint: z.number().int().min(0, 'Cannot be negative').max(1_000_000),
};

export const productCreateSchema = z.object({
  ...productFields,
  category: productFields.category.optional(),
  reorderPoint: productFields.reorderPoint.default(0),
});

export const productUpdateSchema = z
  .object(productFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export type ProductCreateInput = z.input<typeof productCreateSchema>;
export type ProductUpdateInput = z.input<typeof productUpdateSchema>;

export const productSortFields = ['name', 'sku', 'price', 'stock', 'updated'] as const;
export type ProductSortField = (typeof productSortFields)[number];

export const productListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(productSortFields).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  lowStock: z.stringbool().optional(),
  /** Keyset paging: the page after or before a cursor from a previous response. Takes precedence over page. */
  after: z.string().max(500).optional(),
  before: z.string().max(500).optional(),
});

/** The list query as the web app sends it (the schema above parses it from URL strings). */
export type ProductListParams = {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: ProductSortField;
  dir?: 'asc' | 'desc';
  lowStock?: boolean;
  after?: string;
  before?: string;
};

export type ProductListItem = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  priceCents: number;
  reorderPoint: number;
  totalStock: number;
  updatedAt: string;
};

export type StoreStock = {
  storeId: string;
  storeName: string;
  storeCode: string;
  quantity: number;
};

export type ProductDetail = ProductListItem & {
  createdAt: string;
  stock: StoreStock[];
  /** Units sent between stores and not yet received. Not counted in any store's stock. */
  inTransit: number;
};

/** Reasons a person can pick when changing stock by hand. */
export const manualStockReasons = ['received', 'sold', 'damaged', 'correction'] as const;
/** Every reason a stock movement can have, including ones the system records. */
export const stockReasons = [...manualStockReasons, 'import', 'transfer_out', 'transfer_in'] as const;
export type StockReason = (typeof stockReasons)[number];

export const stockAdjustmentSchema = z.object({
  storeId: z.uuid('Choose a store'),
  delta: z
    .number()
    .int('Use a whole number')
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, 'The change cannot be zero'),
  reason: z.enum(manualStockReasons),
  note: z.string().trim().max(500).optional(),
});

export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;

export type StockMovement = {
  id: number;
  storeId: string;
  storeName: string;
  delta: number;
  balanceAfter: number;
  reason: StockReason;
  note: string | null;
  userName: string | null;
  createdAt: string;
};

export type StockAdjustmentResult = {
  quantity: number;
  movement: StockMovement;
};

export const movementsQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * A page of the product list. Follow nextCursor / prevCursor (as `after` / `before`) to move
 * between pages: each page then costs the same however deep it is. `page` is set only when the
 * page was requested by number.
 */
export type ProductPage = {
  items: ProductListItem[];
  total: number;
  /** True when there are more than `total` matches: counting stops at 10,000 to keep pages fast. */
  totalCapped: boolean;
  pageSize: number;
  page: number | null;
  nextCursor: string | null;
  prevCursor: string | null;
};
