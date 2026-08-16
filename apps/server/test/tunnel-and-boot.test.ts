import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSessionSecret } from '../src/services/settings.js';
import { createTestContext, setupAndLogin, TEST_PIN, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  // Point the connector at the node binary: it starts, fails to understand `tunnel …` and exits —
  // exercising spawn / log capture / error state / restart scheduling without a real cloudflared.
  ctx = await createTestContext({ env: { CLOUDFLARED_BIN: process.execPath, PUBLIC_URL: '' } });
  await setupAndLogin(ctx);
});
afterAll(async () => {
  await ctx.app.tunnel.stop();
  await ctx.cleanup();
});

describe('cloudflare tunnel managed from settings', () => {
  it('is off until a token is saved, then supervises the connector and reports status', async () => {
    let s = (await ctx.agent.get('/api/settings').expect(200)).body;
    expect(s.tunnel).toMatchObject({
      tokenSource: 'none',
      state: 'disabled',
      binaryAvailable: true,
    });

    await ctx.agent.patch('/api/settings').send({ cloudflareTunnelToken: 'short' }).expect(400);
    s = (
      await ctx.agent
        .patch('/api/settings')
        .send({ cloudflareTunnelToken: 'eyJhIjoiZmFrZS10b2tlbi1mb3ItdGVzdGluZy1vbmx5In0' })
        .expect(200)
    ).body;
    expect(s.tunnel.tokenSource).toBe('settings');
    expect(['starting', 'error']).toContain(s.tunnel.state);
    expect(JSON.stringify(s)).not.toContain('eyJhIjoiZmFrZS');

    // node exits quickly on the bogus args → error state, log captured, restart scheduled.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && ctx.app.tunnel.status().state !== 'error') {
      await new Promise((r) => setTimeout(r, 50));
    }
    const st = ctx.app.tunnel.status();
    expect(st.state).toBe('error');
    expect(st.lastError).toBeTruthy();
    expect(st.log.some((l) => l.includes('starting cloudflared'))).toBe(true);
    expect(st.log.some((l) => l.includes('restarting in'))).toBe(true);

    const restarted = (await ctx.agent.post('/api/settings/tunnel/restart').expect(200)).body;
    expect(['starting', 'error']).toContain(restarted.tunnel.state);

    const off = (
      await ctx.agent.patch('/api/settings').send({ cloudflareTunnelToken: null }).expect(200)
    ).body;
    expect(off.tunnel).toMatchObject({ tokenSource: 'none', state: 'disabled', lastError: null });
  });

  it('reports the binary as unavailable when it is missing', async () => {
    const other = await createTestContext();
    try {
      await other.agent.post('/api/auth/setup').send({ pin: TEST_PIN }).expect(201);
      const s = (
        await other.agent
          .patch('/api/settings')
          .send({ cloudflareTunnelToken: 'eyJhIjoiZmFrZS10b2tlbi1mb3ItdGVzdGluZy1vbmx5In0' })
          .expect(200)
      ).body;
      expect(s.tunnel.state).toBe('unavailable');
      expect(s.tunnel.binaryAvailable).toBe(false);
    } finally {
      await other.app.tunnel.stop();
      await other.cleanup();
    }
  });
});

describe('zero-config boot helpers', () => {
  it('generates and persists a session secret when none is provided', async () => {
    const a = await resolveSessionSecret(ctx.handle.db, undefined);
    const b = await resolveSessionSecret(ctx.handle.db, undefined);
    expect(a).toHaveLength(64);
    expect(b).toBe(a);
    expect(await resolveSessionSecret(ctx.handle.db, 'from-env-0123456789')).toBe(
      'from-env-0123456789',
    );
  });

  it('auto-detects the public URL from the request when no override is set', async () => {
    const s = (await ctx.agent.get('/api/settings').set('Host', 'totes.example.net').expect(200))
      .body;
    expect(s.publicUrl).toBe('http://totes.example.net');
    expect(s.publicUrlSource).toBe('request');
    const viaProxy = (
      await ctx.agent
        .get('/api/settings')
        .set('Host', 'totes.example.net')
        .set('X-Forwarded-Proto', 'https')
        .expect(200)
    ).body;
    expect(viaProxy.publicUrl).toBe('https://totes.example.net');
  });

  it('marks the session cookie Secure only when the request arrived over https', async () => {
    const plain = await request(ctx.app.app)
      .post('/api/auth/login')
      .set('CF-Connecting-IP', '203.0.113.50')
      .send({ pin: TEST_PIN })
      .expect(200);
    expect(plain.headers['set-cookie']?.[0]).not.toMatch(/Secure/);
    const https = await request(ctx.app.app)
      .post('/api/auth/login')
      .set('CF-Connecting-IP', '203.0.113.51')
      .set('X-Forwarded-Proto', 'https')
      .send({ pin: TEST_PIN })
      .expect(200);
    expect(https.headers['set-cookie']?.[0]).toMatch(/Secure/);
  });
});
