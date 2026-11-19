import {
  formatTransferNumber,
  type TransferDetail,
  type TransferStatus,
  type TransferSummary,
  type transferCreateSchema,
  type transferReceiveSchema,
} from '@stockroom/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { Db, Executor, Tx } from '@/db/client';
import { products, stores, tenants, transferLines, transfers, users } from '@/db/schema';
import { HttpError, notFound } from '@/http/errors';
import { recordEvent, syncLowStockAlerts } from '@/modules/events/outbox';

/*
 * Lock order, shared by every writer in the app so none of them can deadlock with another:
 *   1. the transfer row        (receive, cancel)
 *   2. products, by id
 *   3. stock levels, by (product, store)
 *   4. low-stock alerts        (syncLowStockAlerts)
 */

type Line = { productId: string; quantity: number };

/** Locks the products (in id order) and checks they're active products of this business. */
async function lockProducts(tx: Tx, tenantId: string, productIds: string[]) {
  const rows = await tx.execute<{ id: string; sku: string; name: string }>(sql`
    select id, sku, name from products
    where tenant_id = ${tenantId} and archived_at is null
      and id in (select (jsonb_array_elements_text(${JSON.stringify(productIds)}::jsonb))::uuid)
    order by id
    for update`);
  return new Map(rows.rows.map((r) => [r.id, r]));
}

/**
 * Sends stock: takes it out of the source store now and records the transfer as in transit.
 * Checks every line first, so the error lists every product that's short, not just the first.
 */
export async function createTransfer(
  db: Db,
  input: z.output<typeof transferCreateSchema> & { tenantId: string; userId: string },
) {
  const { tenantId, userId } = input;
  return db.transaction(async (tx) => {
    const storeRows = await tx
      .select({ id: stores.id, code: stores.code })
      .from(stores)
      .where(and(eq(stores.tenantId, tenantId), sql`${stores.id} in (${input.fromStoreId}, ${input.toStoreId})`));
    const from = storeRows.find((s) => s.id === input.fromStoreId);
    const to = storeRows.find((s) => s.id === input.toStoreId);
    if (!from || !to) {
      throw new HttpError(400, 'validation_failed', 'Some fields are invalid', [
        ...(from ? [] : [{ path: 'fromStoreId', message: 'Unknown store' }]),
        ...(to ? [] : [{ path: 'toStoreId', message: 'Unknown store' }]),
      ]);
    }

    const lines: Line[] = [...input.lines].sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const productsById = await lockProducts(tx, tenantId, lines.map((l) => l.productId));
    const unknown = input.lines.flatMap((l, i) => (productsById.has(l.productId) ? [] : [{ path: `lines.${i}.productId`, message: 'Unknown product' }]));
    if (unknown.length) throw new HttpError(400, 'validation_failed', 'Some fields are invalid', unknown);

    // Lock the source stock and check every line before changing anything.
    const levels = await tx.execute<{ product_id: string; quantity: number }>(sql`
      select product_id, quantity from stock_levels
      where store_id = ${from.id}
        and product_id in (select (jsonb_array_elements_text(${JSON.stringify(lines.map((l) => l.productId))}::jsonb))::uuid)
      order by product_id
      for update`);
    const available = new Map(levels.rows.map((r) => [r.product_id, r.quantity]));
    const short = input.lines.flatMap((l, i) => {
      const has = available.get(l.productId) ?? 0;
      return has >= l.quantity ? [] : [{ path: `lines.${i}.quantity`, message: `Only ${has} in stock at ${from.code}` }];
    });
    if (short.length) throw new HttpError(409, 'insufficient_stock', 'Some products are short at the sending store', short);

    // Per-business numbering. The tenant row lock makes concurrent transfers take turns for a number.
    const [counter] = await tx
      .update(tenants)
      .set({ transferSequence: sql`${tenants.transferSequence} + 1` })
      .where(eq(tenants.id, tenantId))
      .returning({ number: tenants.transferSequence });
    const number = counter!.number;

    const [transfer] = await tx
      .insert(transfers)
      .values({ tenantId, number, fromStoreId: from.id, toStoreId: to.id, note: input.note || null, createdBy: userId })
      .returning({ id: transfers.id });
    await tx.insert(transferLines).values(lines.map((l) => ({ transferId: transfer!.id, ...l })));

    await moveStock(tx, {
      tenantId,
      storeId: from.id,
      lines: lines.map((l) => ({ productId: l.productId, delta: -l.quantity })),
      reason: 'transfer_out',
      note: `${formatTransferNumber(number)} to ${to.code}`,
      userId,
      transferId: transfer!.id,
    });
    await syncLowStockAlerts(tx, tenantId, lines.map((l) => l.productId));
    await recordEvent(tx, tenantId, 'transfer.sent', {
      transferId: transfer!.id,
      number: formatTransferNumber(number),
      fromStore: from.code,
      toStore: to.code,
      lines: lines.map((l) => ({ sku: productsById.get(l.productId)!.sku, quantity: l.quantity })),
    });
    return transfer!.id;
  });
}

/**
 * Applies stock changes for several products in one store with set-based statements, and writes
 * a ledger entry for each with the balance after it. Rows must already be locked or be new.
 */
async function moveStock(
  tx: Tx,
  move: {
    tenantId: string;
    storeId: string;
    lines: { productId: string; delta: number }[];
    reason: 'transfer_out' | 'transfer_in';
    note: string;
    userId: string;
    transferId: string;
  },
) {
  const lines = move.lines.filter((l) => l.delta !== 0);
  if (lines.length === 0) return;
  const removing = lines.every((l) => l.delta < 0);
  if (!removing && lines.some((l) => l.delta < 0)) throw new Error('moveStock takes all additions or all removals');
  const json = JSON.stringify(lines.map((l) => ({ product_id: l.productId, delta: l.delta })));

  // Removals must be a plain UPDATE: Postgres checks quantity >= 0 on the row an INSERT proposes
  // before it notices the conflict, so an upsert with a negative quantity always fails.
  const change = removing
    ? sql`
      update stock_levels sl set quantity = sl.quantity + x.delta, updated_at = now()
      from jsonb_to_recordset(${json}::jsonb) as x(product_id uuid, delta int)
      where sl.store_id = ${move.storeId} and sl.product_id = x.product_id
      returning sl.product_id, sl.quantity`
    : sql`
      insert into stock_levels (tenant_id, product_id, store_id, quantity)
      select ${move.tenantId}::uuid, x.product_id, ${move.storeId}::uuid, x.delta
      from jsonb_to_recordset(${json}::jsonb) as x(product_id uuid, delta int)
      order by x.product_id
      on conflict (product_id, store_id) do update
        set quantity = stock_levels.quantity + excluded.quantity, updated_at = now()
      returning product_id, quantity`;

  await tx.execute(sql`
    with changed as (${change})
    insert into stock_movements (tenant_id, product_id, store_id, delta, balance_after, reason, note, user_id, transfer_id)
    select ${move.tenantId}::uuid, c.product_id, ${move.storeId}::uuid, x.delta, c.quantity,
           ${move.reason}::stock_reason, ${move.note}::text, ${move.userId}::uuid, ${move.transferId}::uuid
    from changed c
    join jsonb_to_recordset(${json}::jsonb) as x(product_id uuid, delta int) on x.product_id = c.product_id
    order by c.product_id`);
}

/**
 * Moves an in-transit transfer to its final state. The status condition in the UPDATE is what
 * makes this safe: of two people pressing Receive at once, the second waits for the first's row
 * lock, re-checks the condition, finds the transfer already received, and changes nothing.
 */
async function finish(tx: Tx, tenantId: string, transferId: string, to: 'received' | 'cancelled', userId: string) {
  const [row] = await tx
    .update(transfers)
    .set(
      to === 'received'
        ? { status: 'received', receivedAt: sql`now()`, receivedBy: userId, updatedAt: sql`now()` }
        : { status: 'cancelled', cancelledAt: sql`now()`, cancelledBy: userId, updatedAt: sql`now()` },
    )
    .where(and(eq(transfers.id, transferId), eq(transfers.tenantId, tenantId), eq(transfers.status, 'in_transit')))
    .returning();
  if (row) return row;

  const [existing] = await tx
    .select({ status: transfers.status })
    .from(transfers)
    .where(and(eq(transfers.id, transferId), eq(transfers.tenantId, tenantId)));
  if (!existing) throw notFound('Transfer');
  throw new HttpError(409, 'transfer_closed', `This transfer was already ${existing.status === 'received' ? 'received' : 'cancelled'}`);
}

async function storeCode(tx: Executor, storeId: string) {
  const [store] = await tx.select({ code: stores.code }).from(stores).where(eq(stores.id, storeId));
  return store?.code ?? '?';
}

/** Receives a transfer. Quantities that arrived short are recorded; the shortfall isn't added anywhere. */
export async function receiveTransfer(
  db: Db,
  input: z.output<typeof transferReceiveSchema> & { tenantId: string; userId: string; transferId: string },
) {
  const { tenantId, userId, transferId } = input;
  await db.transaction(async (tx) => {
    const transfer = await finish(tx, tenantId, transferId, 'received', userId);
    const lines = await tx.select().from(transferLines).where(eq(transferLines.transferId, transferId)).orderBy(asc(transferLines.productId));

    const received = new Map(lines.map((l) => [l.productId, l.quantity]));
    const issues: { path: string; message: string }[] = [];
    (input.lines ?? []).forEach((line, i) => {
      const sent = received.get(line.productId);
      if (sent === undefined) issues.push({ path: `lines.${i}.productId`, message: 'Not on this transfer' });
      else if (line.receivedQuantity > sent) issues.push({ path: `lines.${i}.receivedQuantity`, message: `Only ${sent} were sent` });
      else received.set(line.productId, line.receivedQuantity);
    });
    if (issues.length) throw new HttpError(400, 'validation_failed', 'Some fields are invalid', issues);

    const productIds = lines.map((l) => l.productId);
    const productsById = await lockProducts(tx, tenantId, productIds);
    await tx.execute(sql`
      update transfer_lines tl set received_quantity = x.received
      from jsonb_to_recordset(${JSON.stringify(lines.map((l) => ({ product_id: l.productId, received: received.get(l.productId) })))}::jsonb)
        as x(product_id uuid, received int)
      where tl.transfer_id = ${transferId} and tl.product_id = x.product_id`);

    const number = formatTransferNumber(transfer.number);
    const fromCode = await storeCode(tx, transfer.fromStoreId);
    // Products archived while in transit aren't restocked; their lines stay on the record.
    const restock = lines.filter((l) => productsById.has(l.productId));
    await moveStock(tx, {
      tenantId,
      storeId: transfer.toStoreId,
      lines: restock.map((l) => ({ productId: l.productId, delta: received.get(l.productId)! })),
      reason: 'transfer_in',
      note: `${number} from ${fromCode}`,
      userId,
      transferId,
    });
    await syncLowStockAlerts(tx, tenantId, restock.map((l) => l.productId));
    await recordEvent(tx, tenantId, 'transfer.received', {
      transferId,
      number,
      toStore: await storeCode(tx, transfer.toStoreId),
      lines: lines.map((l) => ({
        sku: productsById.get(l.productId)?.sku ?? null,
        sent: l.quantity,
        received: received.get(l.productId),
      })),
    });
  });
  return getTransfer(db, tenantId, transferId);
}

/** Cancels an in-transit transfer and puts the stock back in the store that sent it. */
export async function cancelTransfer(db: Db, input: { tenantId: string; userId: string; transferId: string }) {
  const { tenantId, userId, transferId } = input;
  await db.transaction(async (tx) => {
    const transfer = await finish(tx, tenantId, transferId, 'cancelled', userId);
    const lines = await tx.select().from(transferLines).where(eq(transferLines.transferId, transferId)).orderBy(asc(transferLines.productId));
    const productsById = await lockProducts(tx, tenantId, lines.map((l) => l.productId));
    const back = lines.filter((l) => productsById.has(l.productId));
    const number = formatTransferNumber(transfer.number);
    await moveStock(tx, {
      tenantId,
      storeId: transfer.fromStoreId,
      lines: back.map((l) => ({ productId: l.productId, delta: l.quantity })),
      reason: 'transfer_in',
      note: `${number} cancelled, stock returned`,
      userId,
      transferId,
    });
    await syncLowStockAlerts(tx, tenantId, back.map((l) => l.productId));
    await recordEvent(tx, tenantId, 'transfer.cancelled', { transferId, number });
  });
  return getTransfer(db, tenantId, transferId);
}

// ---- Reading ----

const fromStore = alias(stores, 'from_store');
const toStore = alias(stores, 'to_store');
const creator = alias(users, 'creator');
const receiver = alias(users, 'receiver');
const canceller = alias(users, 'canceller');

const summaryColumns = {
  id: transfers.id,
  number: transfers.number,
  status: transfers.status,
  fromStore: { id: fromStore.id, name: fromStore.name, code: fromStore.code },
  toStore: { id: toStore.id, name: toStore.name, code: toStore.code },
  lineCount: sql<number>`(select count(*)::int from ${transferLines} where ${transferLines.transferId} = ${transfers.id})`,
  totalUnits: sql<number>`(select coalesce(sum(${transferLines.quantity}), 0)::int from ${transferLines} where ${transferLines.transferId} = ${transfers.id})`,
  note: transfers.note,
  createdBy: creator.name,
  createdAt: transfers.createdAt,
  receivedAt: transfers.receivedAt,
  cancelledAt: transfers.cancelledAt,
};

function baseQuery(db: Executor) {
  return db
    .select({ ...summaryColumns, receivedBy: receiver.name, cancelledBy: canceller.name })
    .from(transfers)
    .innerJoin(fromStore, eq(fromStore.id, transfers.fromStoreId))
    .innerJoin(toStore, eq(toStore.id, transfers.toStoreId))
    .leftJoin(creator, eq(creator.id, transfers.createdBy))
    .leftJoin(receiver, eq(receiver.id, transfers.receivedBy))
    .leftJoin(canceller, eq(canceller.id, transfers.cancelledBy))
    .$dynamic();
}

export async function listTransfers(db: Executor, tenantId: string, status?: TransferStatus): Promise<TransferSummary[]> {
  const rows = await baseQuery(db)
    .where(and(eq(transfers.tenantId, tenantId), status ? eq(transfers.status, status) : undefined))
    .orderBy(desc(transfers.number))
    .limit(100);
  return rows.map(({ receivedBy: _r, cancelledBy: _c, ...summary }) => summary as unknown as TransferSummary);
}

export async function getTransfer(db: Executor, tenantId: string, transferId: string): Promise<TransferDetail> {
  const [row] = await baseQuery(db).where(and(eq(transfers.id, transferId), eq(transfers.tenantId, tenantId)));
  if (!row) throw notFound('Transfer');
  const lines = await db
    .select({
      productId: transferLines.productId,
      sku: products.sku,
      name: products.name,
      quantity: transferLines.quantity,
      receivedQuantity: transferLines.receivedQuantity,
    })
    .from(transferLines)
    .innerJoin(products, eq(products.id, transferLines.productId))
    .where(eq(transferLines.transferId, transferId))
    .orderBy(asc(products.name));
  return { ...(row as unknown as TransferDetail), lines };
}
