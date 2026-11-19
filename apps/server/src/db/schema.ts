import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Every business table carries tenant_id, and every query filters on it.
 * Deleting a tenant removes all of its data.
 */
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const userRole = pgEnum('user_role', ['owner', 'staff']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** Always stored in lower case. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('staff'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email), index('users_tenant_idx').on(t.tenantId)],
);

/** Server-side sessions. The id is a SHA-256 hash of the cookie token, so a database leak can't be replayed. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stores_tenant_code_key').on(t.tenantId, t.code)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    priceCents: integer('price_cents').notNull(),
    reorderPoint: integer('reorder_point').notNull().default(0),
    /** Products are archived, not deleted, so their stock history stays intact. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A SKU is unique among a tenant's active products; archiving one frees the SKU.
    uniqueIndex('products_tenant_sku_key').on(t.tenantId, t.sku).where(sql`archived_at is null`),
    index('products_tenant_name_idx').on(t.tenantId, t.name),
    check('products_price_nonnegative', sql`${t.priceCents} >= 0`),
    check('products_reorder_point_nonnegative', sql`${t.reorderPoint} >= 0`),
  ],
);

/**
 * Current quantity of each product in each store. It is derived from stock_movements and updated
 * in the same transaction as each movement. The check constraint is what stops stock going
 * negative, even when two requests race.
 */
export const stockLevels = pgTable(
  'stock_levels',
  {
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.storeId] }),
    index('stock_levels_store_idx').on(t.storeId),
    check('stock_levels_quantity_nonnegative', sql`${t.quantity} >= 0`),
  ],
);

export const stockReason = pgEnum('stock_reason', [
  'received',
  'sold',
  'damaged',
  'correction',
  'import',
  'transfer_out',
  'transfer_in',
]);

/** Append-only ledger of every stock change. This is the source of truth for stock history. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: stockReason('reason').notNull(),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The bulk import that made this change, if any. */
    importId: uuid('import_id').references(() => imports.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_movements_product_idx').on(t.tenantId, t.productId, t.id),
    check('stock_movements_delta_nonzero', sql`${t.delta} <> 0`),
  ],
);

/**
 * Responses to requests sent with an Idempotency-Key header. A retried request gets the stored
 * response back instead of running again. A null status_code means the first request is still running.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: tenantId(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] }), index('idempotency_keys_created_idx').on(t.createdAt)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const importStatus = pgEnum('import_status', ['queued', 'processing', 'completed', 'failed']);
export const importFormat = pgEnum('import_format', ['csv', 'xlsx']);

/**
 * One row per uploaded spreadsheet. This table, not the queue, is the source of truth for an
 * import: the queue only delivers work, and a sweeper re-queues anything the queue lost.
 */
export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    /** SHA-256 of the file, used to spot the same file being uploaded twice. */
    fileHash: text('file_hash').notNull(),
    format: importFormat('format').notNull(),
    status: importStatus('status').notNull().default('queued'),
    totalRows: integer('total_rows'),
    /** Checkpoint: data rows committed so far. Updated in the same transaction as each chunk's writes. */
    processedRows: integer('processed_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    stockChangeCount: integer('stock_change_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('imports_tenant_created_idx').on(t.tenantId, t.createdAt),
    // The same file can't be queued twice at once (a double-click or a retried upload).
    uniqueIndex('imports_active_file_key')
      .on(t.tenantId, t.fileHash)
      .where(sql`status in ('queued', 'processing')`),
    // One running import per business, so a big file from one business can't hog the workers.
    uniqueIndex('imports_one_processing_per_tenant_key').on(t.tenantId).where(sql`status = 'processing'`),
    // Lets the sweeper find unfinished imports cheaply.
    index('imports_unfinished_idx').on(t.updatedAt).where(sql`status in ('queued', 'processing')`),
  ],
);

/** The uploaded file, kept in Postgres (free tiers have no object storage) and deleted once the import ends. */
export const importFiles = pgTable('import_files', {
  importId: uuid('import_id')
    .primaryKey()
    .references(() => imports.id, { onDelete: 'cascade' }),
  content: bytea('content').notNull(),
});

/** Problems found in individual rows. Capped per import; error_count on imports has the full total. */
export const importErrors = pgTable(
  'import_errors',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    sku: text('sku'),
    column: text('column'),
    message: text('message').notNull(),
  },
  (t) => [index('import_errors_import_idx').on(t.importId, t.rowNumber)],
);
