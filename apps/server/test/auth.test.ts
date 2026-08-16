import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, TEST_PIN, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('auth', () => {
  it('health is public', async () => {
    const res = await request(ctx.app.app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('requires setup first, rejects protected routes, then allows setup + login', async () => {
    const status = await ctx.agent.get('/api/auth/status').expect(200);
    expect(status.body).toEqual({ setupRequired: true, authenticated: false });

    await ctx.agent.get('/api/boxes').expect(401);
    await ctx.agent.post('/api/auth/login').send({ pin: TEST_PIN }).expect(409);

    await ctx.agent.post('/api/auth/setup').send({ pin: '12' }).expect(400); // too short
    const setup = await ctx.agent.post('/api/auth/setup').send({ pin: TEST_PIN }).expect(201);
    expect(setup.headers['set-cookie']?.[0]).toMatch(/tt_session=.*HttpOnly/);
    await ctx.agent.post('/api/auth/setup').send({ pin: '8888' }).expect(409);

    const after = await ctx.agent.get('/api/auth/status').expect(200);
    expect(after.body).toEqual({ setupRequired: false, authenticated: true });
    await ctx.agent.get('/api/boxes').expect(200);

    await ctx.agent.post('/api/auth/logout').expect(200);
    await ctx.agent.get('/api/boxes').expect(401);

    await ctx.agent.post('/api/auth/login').send({ pin: '0000' }).expect(401);
    await ctx.agent.post('/api/auth/login').send({ pin: TEST_PIN }).expect(200);
    await ctx.agent.get('/api/boxes').expect(200);
  });

  it('rejects tampered session cookies', async () => {
    const res = await request(ctx.app.app)
      .get('/api/boxes')
      .set('Cookie', 'tt_session=eyJ2IjoxfQ.badsignature')
      .expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rate limits failed logins to 5 per 15 minutes per client IP (proxy-aware)', async () => {
    const fresh = request.agent(ctx.app.app);
    for (let i = 0; i < 5; i++) {
      await fresh
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ pin: '0000' })
        .expect(401);
    }
    const limited = await fresh
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ pin: TEST_PIN })
      .expect(429);
    expect(limited.body.error.code).toBe('rate_limited');
    // A different client IP is unaffected.
    await request(ctx.app.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ pin: TEST_PIN })
      .expect(200);
  });

  it('changing the PIN keeps other sessions logged in and requires the new PIN afterwards', async () => {
    const other = request.agent(ctx.app.app);
    await other
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.1')
      .send({ pin: TEST_PIN })
      .expect(200);
    await other.get('/api/boxes').expect(200);

    await ctx.agent
      .post('/api/auth/change-pin')
      .send({ currentPin: '0000', newPin: '9999' })
      .expect(401);
    await ctx.agent
      .post('/api/auth/change-pin')
      .send({ currentPin: TEST_PIN, newPin: '9999' })
      .expect(200);

    await ctx.agent.get('/api/boxes').expect(200);
    await other.get('/api/boxes').expect(200); // still valid

    const fresh = request.agent(ctx.app.app);
    await fresh
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.2')
      .send({ pin: TEST_PIN })
      .expect(401);
    await fresh
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.2')
      .send({ pin: '9999' })
      .expect(200);
    await fresh.get('/api/boxes').expect(200);
  });

  it('POST /auth/sign-out-everywhere needs the PIN and signs out every device', async () => {
    const other = request.agent(ctx.app.app);
    await other.post('/api/auth/login').send({ pin: '9999' }).expect(200);
    await ctx.agent.post('/api/auth/sign-out-everywhere').send({ pin: '0000' }).expect(401);
    await other.get('/api/boxes').expect(200);
    await ctx.agent.post('/api/auth/sign-out-everywhere').send({ pin: '9999' }).expect(200);
    await other.get('/api/boxes').expect(401);
    await ctx.agent.get('/api/boxes').expect(401);
    await ctx.agent.post('/api/auth/login').send({ pin: '9999' }).expect(200);
  });

  it('rotating the session generation signs out every device', async () => {
    await ctx.agent.get('/api/boxes').expect(200);
    await ctx.app.pins.rotateGeneration();
    await ctx.agent.get('/api/boxes').expect(401);
    await ctx.agent
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.3')
      .send({ pin: '9999' })
      .expect(200);
    await ctx.agent.get('/api/boxes').expect(200);
  });
});
