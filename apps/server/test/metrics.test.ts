import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createProduct, setupTestApp, signUp } from './helpers';

const { app } = setupTestApp();
const { app: tokenApp } = setupTestApp({ metricsToken: 'a-long-enough-metrics-token' });
const { app: productionApp } = setupTestApp({ isProduction: true });

describe('metrics', () => {
  it('reports request latency by route pattern, not by raw URL', async () => {
    const { agent } = await signUp(app);
    const product = await createProduct(agent);
    await agent.get(`/api/products/${product.id}`);

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('stockroom_http_request_duration_seconds_bucket');
    expect(res.text).toMatch(/route="\/api\/products\/:id",status="2xx"/);
    expect(res.text).not.toContain(product.id); // ids would make one time series per product
    expect(res.text).toContain('stockroom_nodejs_eventloop_lag_seconds');
  });

  it('needs the bearer token when one is set', async () => {
    expect((await request(tokenApp).get('/metrics')).status).toBe(401);
    expect((await request(tokenApp).get('/metrics').set('Authorization', 'Bearer wrong-token-of-same-size!!')).status).toBe(401);
    expect((await request(tokenApp).get('/metrics').set('Authorization', 'Bearer a-long-enough-metrics-token')).status).toBe(200);
  });

  it('is off in production unless a token is set', async () => {
    expect((await request(productionApp).get('/metrics')).status).toBe(404);
  });
});
