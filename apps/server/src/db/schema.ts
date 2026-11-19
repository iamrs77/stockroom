import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
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

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Last transfer number handed out, so each business numbers its transfers TR-0001, TR-0002, ... */
    transferSequence: integer('transfer_sequence').notNull().default(0),
    /** Set for a visitor's demo sandbox: when it's deleted. Null for real businesses. */
    demoExpiresAt: timestamp('demo_expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('tenants_demo_expires_idx').on(t.demoExpiresAt).where(sql`demo_expires_at is not null`)],
);

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
    /** Removed from the team. Kept, not deleted, so their name stays on the history they made. */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
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
    /**
     * Sum of this product's stock_levels, kept in step by statement-level triggers on stock_levels
     * (migration 0005). Stored so lists can sort and filter by stock with an index instead of
     * adding up every product's stock on each request.
     */
    totalStock: integer('total_stock').notNull().default(0),
    /**
     * At or below the reorder point. Stored as its own column because Postgres can't estimate a
     * comparison between two columns (it guesses a third of rows match), but it keeps exact
     * statistics for a boolean, so the low-stock filter gets the right plan.
     */
    lowStock: boolean('low_stock').generatedAlwaysAs(sql`reorder_point > 0 and total_stock <= reorder_point`),
    /** What search matches against: name, SKU and category, lower-cased, with a trigram index. */
    searchText: text('search_text').generatedAlwaysAs(sql`lower(name || ' ' || sku || ' ' || coalesce(category, ''))`),
    /** Products are archived, not deleted, so their stock history stays intact. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => {
    // Every list sort reads one of these: (tenant, sort value, id) over active products, so a page
    // is an index range scan whichever way it's sorted, and the id makes the order total for paging.
    const active = sql`archived_at is null`;
    return [
      // A SKU is unique among a tenant's active products; archiving one frees the SKU.
      uniqueIndex('products_tenant_sku_key').on(t.tenantId, t.sku).where(active),
      index('products_active_name_idx').on(t.tenantId, t.name, t.id).where(active),
      index('products_active_stock_idx').on(t.tenantId, t.totalStock, t.id).where(active),
      index('products_active_price_idx').on(t.tenantId, t.priceCents, t.id).where(active),
      index('products_active_updated_idx').on(t.tenantId, t.updatedAt, t.id).where(active),
      // Small: only active products that are low on stock, in the list's default order.
      index('products_low_stock_idx').on(t.tenantId, t.name, t.id).where(sql`archived_at is null and low_stock`),
      index('products_search_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
      check('products_price_nonnegative', sql`${t.priceCents} >= 0`),
      check('products_reorder_point_nonnegative', sql`${t.reorderPoint} >= 0`),
      check('products_total_stock_nonnegative', sql`${t.totalStock} >= 0`),
    ];
  },
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
    /** The transfer that made this change, if any. */
    transferId: uuid('transfer_id').references(() => transfers.id, { onDelete: 'set null' }),
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

// ---- Transfers ----

export const transferStatus = pgEnum('transfer_status', ['in_transit', 'received', 'cancelled']);

/**
 * Stock moving between two stores. Sending takes it out of the source store; receiving adds what
 * actually arrived to the destination. The status only moves forward, from in_transit to received
 * or cancelled, and every move is a guarded UPDATE, so two people can't receive the same transfer.
 */
export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    fromStoreId: uuid('from_store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    toStoreId: uuid('to_store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    status: transferStatus('status').notNull().default('in_transit'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('transfers_tenant_number_key').on(t.tenantId, t.number),
    index('transfers_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('transfers_different_stores', sql`${t.fromStoreId} <> ${t.toStoreId}`),
  ],
);

export const transferLines = pgTable(
  'transfer_lines',
  {
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    /** What actually arrived. Null until the transfer is received. */
    receivedQuantity: integer('received_quantity'),
  },
  (t) => [
    primaryKey({ columns: [t.transferId, t.productId] }),
    index('transfer_lines_product_idx').on(t.productId),
    check('transfer_lines_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'transfer_lines_received_in_range',
      sql`${t.receivedQuantity} is null or (${t.receivedQuantity} >= 0 and ${t.receivedQuantity} <= ${t.quantity})`,
    ),
  ],
);

// ---- Low-stock alerts and the outbox ----

/**
 * A product at or below its reorder point. At most one open alert per product (partial unique
 * index), so a product hovering around its reorder point can't raise a flood of alerts.
 */
export const lowStockAlerts = pgTable(
  'low_stock_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    stockAtOpen: integer('stock_at_open').notNull(),
    reorderPointAtOpen: integer('reorder_point_at_open').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    stockAtResolve: integer('stock_at_resolve'),
  },
  (t) => [
    uniqueIndex('low_stock_alerts_one_open_key').on(t.productId).where(sql`resolved_at is null`),
    index('low_stock_alerts_tenant_open_idx').on(t.tenantId, t.openedAt).where(sql`resolved_at is null`),
  ],
);

/**
 * Transactional outbox. Events are written in the same transaction as the change they describe,
 * so an event exists exactly when its change committed. A relay delivers them afterwards.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** The id receivers see, and use to ignore an event delivered twice. */
    eventId: uuid('event_id').notNull().defaultRandom().unique(),
    tenantId: tenantId(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    index('outbox_events_unpublished_idx').on(t.id).where(sql`published_at is null`),
    index('outbox_events_published_idx').on(t.publishedAt),
  ],
);

// ---- Webhooks ----

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    url: text('url').notNull(),
    description: text('description'),
    /** Signing secret. Stored as-is because every delivery has to be signed with it. */
    secret: text('secret').notNull(),
    eventTypes: text('event_types').array().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('webhook_endpoints_tenant_idx').on(t.tenantId)],
);

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', ['pending', 'succeeded', 'failed']);

/** One row per (endpoint, event). The unique key makes fanning an event out twice harmless. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.eventId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('webhook_deliveries_endpoint_event_key').on(t.endpointId, t.eventId),
    index('webhook_deliveries_endpoint_created_idx').on(t.endpointId, t.createdAt),
    index('webhook_deliveries_pending_idx').on(t.updatedAt).where(sql`status = 'pending'`),
  ],
);

// ---- Team ----

/** An invitation link. Only a hash of its token is stored; the link itself is shown once. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    tokenHash: text('token_hash').notNull().unique(),
    role: userRole('role').notNull().default('staff'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('invites_tenant_idx').on(t.tenantId)],
);
