import { transferCreateSchema, transferListQuerySchema, transferReceiveSchema } from '@stockroom/shared';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import { getAuth } from '../../http/auth';
import { idempotent } from '../../http/idempotency';
import { parse, parseId } from '../../http/validate';
import { cancelTransfer, createTransfer, getTransfer, listTransfers, receiveTransfer } from './service';

export function transfersRouter(deps: AppDeps) {
  const { db, outbox } = deps;
  const router = Router();

  router.get('/', async (req, res) => {
    const { tenant } = getAuth(req);
    const { status } = parse(transferListQuerySchema, req.query);
    res.json({ items: await listTransfers(db, tenant.id, status) });
  });

  router.post('/', idempotent(deps), async (req, res) => {
    const auth = getAuth(req);
    const input = parse(transferCreateSchema, req.body);
    const id = await createTransfer(db, { ...input, tenantId: auth.tenant.id, userId: auth.id });
    outbox.poke();
    res.status(201).json(await getTransfer(db, auth.tenant.id, id));
  });

  router.get('/:id', async (req, res) => {
    const { tenant } = getAuth(req);
    res.json(await getTransfer(db, tenant.id, parseId(req.params.id, 'Transfer')));
  });

  router.post('/:id/receive', idempotent(deps), async (req, res) => {
    const auth = getAuth(req);
    const input = parse(transferReceiveSchema, req.body ?? {});
    const transfer = await receiveTransfer(db, {
      ...input,
      tenantId: auth.tenant.id,
      userId: auth.id,
      transferId: parseId(req.params.id, 'Transfer'),
    });
    outbox.poke();
    res.json(transfer);
  });

  router.post('/:id/cancel', idempotent(deps), async (req, res) => {
    const auth = getAuth(req);
    const transfer = await cancelTransfer(db, { tenantId: auth.tenant.id, userId: auth.id, transferId: parseId(req.params.id, 'Transfer') });
    outbox.poke();
    res.json(transfer);
  });

  return router;
}
