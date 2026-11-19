import { storeInputSchema } from '@stockroom/shared';
import { Router } from 'express';
import type { AppDeps } from '@/app';
import { getAuth, requireRole } from '@/http/auth';
import { parse } from '@/http/validate';
import { createStore, listStores } from './service';

/** A business's stores. Anyone can list them; only owners add them. */
export function storesRouter({ db }: AppDeps) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { tenant } = getAuth(req);
    res.json({ items: await listStores(db, tenant.id) });
  });

  router.post('/', requireRole('owner'), async (req, res) => {
    const { tenant } = getAuth(req);
    res.status(201).json(await createStore(db, tenant.id, parse(storeInputSchema, req.body)));
  });

  return router;
}
