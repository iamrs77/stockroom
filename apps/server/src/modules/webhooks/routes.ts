import { webhookEndpointCreateSchema, webhookEndpointUpdateSchema } from '@stockroom/shared';
import { Router } from 'express';
import type { AppDeps } from '@/app';
import { getAuth, requireRole } from '@/http/auth';
import { parse, parseId } from '@/http/validate';
import {
  createEndpoint,
  deleteEndpoint,
  listDeliveries,
  listEndpoints,
  recordTestEvent,
  updateEndpoint,
} from './service';

/** Webhook endpoints. Owners only: an endpoint receives business data. */
export function webhooksRouter({ db, config, outbox }: AppDeps) {
  const router = Router();
  router.use(requireRole('owner'));

  router.get('/', async (req, res) => {
    res.json({ items: await listEndpoints(db, getAuth(req).tenant.id) });
  });

  router.post('/', async (req, res) => {
    const { tenant } = getAuth(req);
    const input = parse(webhookEndpointCreateSchema, req.body);
    res.status(201).json(await createEndpoint(db, tenant.id, input, { allowPrivate: config.webhooksAllowPrivate }));
  });

  router.patch('/:id', async (req, res) => {
    const { tenant } = getAuth(req);
    const id = parseId(req.params.id, 'Webhook endpoint');
    res.json(await updateEndpoint(db, tenant.id, id, parse(webhookEndpointUpdateSchema, req.body)));
  });

  router.delete('/:id', async (req, res) => {
    const { tenant } = getAuth(req);
    await deleteEndpoint(db, tenant.id, parseId(req.params.id, 'Webhook endpoint'));
    res.status(204).end();
  });

  router.post('/:id/test', async (req, res) => {
    const { tenant } = getAuth(req);
    await recordTestEvent(db, tenant.id, parseId(req.params.id, 'Webhook endpoint'));
    outbox.poke();
    res.status(202).json({ queued: true });
  });

  router.get('/:id/deliveries', async (req, res) => {
    const { tenant } = getAuth(req);
    res.json({ items: await listDeliveries(db, tenant.id, parseId(req.params.id, 'Webhook endpoint')) });
  });

  return router;
}
