import {
  movementsQuerySchema,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  stockAdjustmentSchema,
} from '@stockroom/shared';
import { Router } from 'express';
import type { AppDeps } from '@/app';
import { getAuth, requireRole } from '@/http/auth';
import { idempotent } from '@/http/idempotency';
import { parse, parseId } from '@/http/validate';
import { applyStockChange, listMovements } from '@/modules/stock/service';
import { archiveProduct, createProduct, getProduct, listProducts, updateProduct } from './service';

/** The product catalogue, plus each product's stock history and stock changes. Only owners edit products. */
export function productsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();

  router.get('/', async (req, res) => {
    const { tenant } = getAuth(req);
    res.json(await listProducts(db, tenant.id, parse(productListQuerySchema, req.query)));
  });

  const ownerOnly = requireRole('owner');

  router.post('/', ownerOnly, async (req, res) => {
    const { tenant } = getAuth(req);
    const product = await createProduct(db, tenant.id, parse(productCreateSchema, req.body));
    res.status(201).json(product);
  });

  router.get('/:id', async (req, res) => {
    const { tenant } = getAuth(req);
    res.json(await getProduct(db, tenant.id, parseId(req.params.id, 'Product')));
  });

  router.patch('/:id', ownerOnly, async (req, res) => {
    const { tenant } = getAuth(req);
    const id = parseId(req.params.id, 'Product');
    const product = await updateProduct(db, tenant.id, id, parse(productUpdateSchema, req.body));
    deps.outbox.poke();
    res.json(product);
  });

  router.delete('/:id', ownerOnly, async (req, res) => {
    const { tenant } = getAuth(req);
    await archiveProduct(db, tenant.id, parseId(req.params.id, 'Product'));
    deps.outbox.poke();
    res.status(204).end();
  });

  router.get('/:id/movements', async (req, res) => {
    const { tenant } = getAuth(req);
    const id = parseId(req.params.id, 'Product');
    res.json(await listMovements(db, tenant.id, id, parse(movementsQuerySchema, req.query)));
  });

  router.post('/:id/stock-adjustments', idempotent(deps), async (req, res) => {
    const auth = getAuth(req);
    const productId = parseId(req.params.id, 'Product');
    const input = parse(stockAdjustmentSchema, req.body);
    const result = await applyStockChange(db, {
      tenantId: auth.tenant.id,
      productId,
      storeId: input.storeId,
      delta: input.delta,
      reason: input.reason,
      note: input.note,
      userId: auth.id,
    });
    deps.outbox.poke();
    res.status(201).json(result);
  });

  return router;
}
