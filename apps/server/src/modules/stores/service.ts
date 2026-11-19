import type { storeInputSchema } from '@stockroom/shared';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, PG_UNIQUE_VIOLATION, type Db } from '@/db/client';
import { stores } from '@/db/schema';
import { HttpError } from '@/http/errors';

const storeColumns = { id: stores.id, name: stores.name, code: stores.code, createdAt: stores.createdAt };

/** A business's stores, by name. */
export function listStores(db: Db, tenantId: string) {
  return db.select(storeColumns).from(stores).where(eq(stores.tenantId, tenantId)).orderBy(asc(stores.name));
}

/** Adds a store. Its code must be unique within the business. */
export async function createStore(db: Db, tenantId: string, input: z.output<typeof storeInputSchema>) {
  try {
    const [store] = await db
      .insert(stores)
      .values({ tenantId, ...input })
      .returning(storeColumns);
    return store!;
  } catch (err) {
    if (pgError(err)?.code === PG_UNIQUE_VIOLATION) {
      throw new HttpError(409, 'store_code_taken', `You already have a store with the code ${input.code}`);
    }
    throw err;
  }
}
