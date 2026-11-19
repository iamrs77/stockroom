import { storeInputSchema } from '@stockroom/shared';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import { pgError, PG_UNIQUE_VIOLATION } from '../../db/client';
import { stores } from '../../db/schema';
import { getAuth, requireRole } from '../../http/auth';
import { HttpError } from '../../http/errors';
import { parse } from '../../http/validate';

const storeColumns = { id: stores.id, name: stores.name, code: stores.code, createdAt: stores.createdAt };

export function storesRouter({ db }: AppDeps) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { tenant } = getAuth(req);
    const items = await db
      .select(storeColumns)
      .from(stores)
      .where(eq(stores.tenantId, tenant.id))
      .orderBy(asc(stores.name));
    res.json({ items });
  });

  router.post('/', requireRole('owner'), async (req, res) => {
    const { tenant } = getAuth(req);
    const input = parse(storeInputSchema, req.body);
    try {
      const [store] = await db
        .insert(stores)
        .values({ tenantId: tenant.id, ...input })
        .returning(storeColumns);
      res.status(201).json(store);
    } catch (err) {
      if (pgError(err)?.code === PG_UNIQUE_VIOLATION) {
        throw new HttpError(409, 'store_code_taken', `You already have a store with the code ${input.code}`);
      }
      throw err;
    }
  });

  return router;
}
