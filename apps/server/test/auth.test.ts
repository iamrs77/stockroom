import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PASSWORD, setupTestApp, signUp } from './helpers';

const { app } = setupTestApp();
const { app: rateLimitedApp } = setupTestApp({ authRateLimit: 3 });

describe('auth', () => {
  it('signs up a business with an owner and a first store', async () => {
    const { agent, email, user } = await signUp(app, 'Maple & Pine');
    expect(user).toMatchObject({ email, role: 'owner', tenant: { name: 'Maple & Pine' } });

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);

    const stores = await agent.get('/api/stores');
    expect(stores.body.items).toEqual([expect.objectContaining({ name: 'Main store', code: 'MAIN' })]);
  });

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({
      businessName: 'Cookie Co',
      name: 'Owner',
      email: `cookie-${Date.now()}@example.com`,
      password: PASSWORD,
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects a second account with the same email, in any case', async () => {
    const { email } = await signUp(app);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ businessName: 'Other', name: 'Someone', email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('lists every invalid field', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['businessName', 'email', 'name', 'password']);
  });

  it('signs in, and gives the same error for a wrong password and an unknown email', async () => {
    const { email } = await signUp(app);

    const ok = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(ok.status).toBe(200);

    const wrongPassword = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('ends the session on sign out', async () => {
    const { email } = await signUp(app);
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    const setCookie = login.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie[0]!.split(';')[0]!;

    const me = () => request(app).get('/api/auth/me').set('Cookie', cookie);
    expect((await me()).body.user.email).toBe(email);
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    // Replaying the old cookie fails: the session is deleted on the server, not just in the browser.
    expect((await me()).body).toEqual({ user: null });
    expect((await request(app).get('/api/products').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects requests without a session', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rate-limits sign-in attempts', async () => {
    const attempt = () =>
      request(rateLimitedApp).post('/api/auth/login').send({ email: 'a@example.com', password: 'x' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('too_many_requests');
  });
});
