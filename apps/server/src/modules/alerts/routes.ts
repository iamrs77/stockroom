import { Router } from 'express';
import type { AppDeps } from '@/app';
import { getAuth } from '@/http/auth';
import { listOpenAlerts } from './service';

/** Low-stock alerts. They're opened and resolved by stock changes (see events/outbox), never by hand. */
export function alertsRouter({ db }: AppDeps) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await listOpenAlerts(db, getAuth(req).tenant.id));
  });

  return router;
}
