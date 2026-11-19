import { randomUUID } from 'node:crypto';
import type { Team } from '@stockroom/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createProduct, PASSWORD, setupTestApp, signUp } from './helpers';

const { app } = setupTestApp();

/** An owner, plus a staff member who joined through an invite link. */
async function setup() {
  const owner = await signUp(app, 'Maple & Pine');
  const invite = await owner.agent.post('/api/team/invites').send({ role: 'staff' });
  expect(invite.status).toBe(201);
  const staff = request.agent(app);
  const email = `staff-${randomUUID()}@example.com`;
  const accepted = await staff.post(`/api/invites/${invite.body.token}/accept`).send({ name: 'Sam Staff', email, password: PASSWORD });
  expect(accepted.status).toBe(201);
  return { owner, staff, staffUser: accepted.body.user, staffEmail: email, token: invite.body.token as string };
}

describe('team', () => {
  it('lets someone join a business through an invite link', async () => {
    const owner = await signUp(app, 'Maple & Pine');
    const invite = await owner.agent.post('/api/team/invites').send({});
    expect(invite.body.token).toMatch(/^[\w-]{43}$/);

    const preview = await request(app).get(`/api/invites/${invite.body.token}`);
    expect(preview.body).toMatchObject({ businessName: 'Maple & Pine', role: 'staff' });

    const staff = request.agent(app);
    const res = await staff
      .post(`/api/invites/${invite.body.token}/accept`)
      .send({ name: 'Sam Staff', email: `sam-${randomUUID()}@example.com`, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Sam Staff', role: 'staff', tenant: { name: 'Maple & Pine' } });
    // They're signed in and see the same business's stores.
    expect((await staff.get('/api/stores')).body.items[0].id).toBe(owner.mainStore.id);
  });

  it('uses each invite link once', async () => {
    const t = await setup();
    const again = await request(app)
      .post(`/api/invites/${t.token}/accept`)
      .send({ name: 'Someone', email: `x-${randomUUID()}@example.com`, password: PASSWORD });
    expect(again.status).toBe(410);
    expect((await request(app).get(`/api/invites/${t.token}`)).status).toBe(410);
  });

  it('makes exactly one account when the same link is used twice at once', async () => {
    const owner = await signUp(app);
    const { body } = await owner.agent.post('/api/team/invites').send({});
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        request(app)
          .post(`/api/invites/${body.token}/accept`)
          .send({ name: `Racer ${i}`, email: `racer-${i}-${randomUUID()}@example.com`, password: PASSWORD }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 410, 410]);
    const team = (await owner.agent.get('/api/team')).body as Team;
    expect(team.members).toHaveLength(2);
  });

  it('stops a revoked invite from working', async () => {
    const owner = await signUp(app);
    const { body } = await owner.agent.post('/api/team/invites').send({});
    expect((await owner.agent.get('/api/team')).body.invites).toHaveLength(1);
    expect((await owner.agent.delete(`/api/team/invites/${body.invite.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/invites/${body.token}`)).status).toBe(410);
  });

  it('lets staff move stock but not change products, stores, imports, the team or webhooks', async () => {
    const t = await setup();
    const product = await createProduct(t.owner.agent, { sku: 'MUG' });

    const adjust = await t.staff
      .post(`/api/products/${product.id}/stock-adjustments`)
      .send({ storeId: t.owner.mainStore.id, delta: 4, reason: 'received' });
    expect(adjust.status).toBe(201);
    expect(adjust.body.movement.userName).toBe('Sam Staff');
    expect((await t.staff.get('/api/products')).status).toBe(200);

    const forbidden = [
      await t.staff.post('/api/products').send({ sku: 'NEW', name: 'New', priceCents: 1 }),
      await t.staff.patch(`/api/products/${product.id}`).send({ priceCents: 1 }),
      await t.staff.delete(`/api/products/${product.id}`),
      await t.staff.post('/api/stores').send({ name: 'Pop-up', code: 'POP' }),
      await t.staff.post('/api/imports').query({ fileName: 'x.csv' }).set('Content-Type', 'text/csv').send('sku,price\nA,1\n'),
      await t.staff.get('/api/team'),
      await t.staff.post('/api/team/invites').send({}),
      await t.staff.get('/api/webhooks'),
    ];
    expect(forbidden.map((r) => r.status)).toEqual(Array(forbidden.length).fill(403));
  });

  it('ends access immediately when someone is removed, and keeps their name on history', async () => {
    const t = await setup();
    const product = await createProduct(t.owner.agent, { sku: 'TOTE' });
    await t.staff.post(`/api/products/${product.id}/stock-adjustments`).send({ storeId: t.owner.mainStore.id, delta: 2, reason: 'received' });

    expect((await t.owner.agent.delete(`/api/team/members/${t.staffUser.id}`)).status).toBe(204);

    expect((await t.staff.get('/api/products')).status).toBe(401); // the open session no longer works
    const login = await request(app).post('/api/auth/login').send({ email: t.staffEmail, password: PASSWORD });
    expect(login.status).toBe(401); // same answer as a wrong password
    const history = await t.owner.agent.get(`/api/products/${product.id}/movements`);
    expect(history.body.items[0].userName).toBe('Sam Staff');
    expect((await t.owner.agent.get('/api/team')).body.members.map((m: { name: string }) => m.name)).toEqual(['Owner']);
  });

  it("doesn't let owners remove themselves or touch another business's team", async () => {
    const t = await setup();
    expect((await t.owner.agent.delete(`/api/team/members/${(await t.owner.agent.get('/api/auth/me')).body.user.id}`)).status).toBe(409);
    const other = await signUp(app);
    expect((await other.agent.delete(`/api/team/members/${t.staffUser.id}`)).status).toBe(404);
  });
});
