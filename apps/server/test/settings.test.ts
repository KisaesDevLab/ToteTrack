import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestContext,
  makeJpeg,
  seedBasics,
  setupAndLogin,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let boxId: number;
const seenPrompts: string[] = [];

beforeAll(async () => {
  ctx = await createTestContext({
    ai: {
      analyzeOverride: async (_images, _model, systemPrompt) => {
        seenPrompts.push(systemPrompt);
        return JSON.stringify({ description: 'ok', items: [] });
      },
    },
  });
  await setupAndLogin(ctx);
  const ids = await seedBasics(ctx);
  boxId = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id })).body.id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('settings', () => {
  it('reports defaults and never leaks the API key', async () => {
    const s = (await ctx.agent.get('/api/settings').expect(200)).body;
    expect(s.aiKeySource).toBe('none');
    expect(s.aiKeyHint).toBeNull();
    expect(s.aiSystemPromptCustom).toBe(false);
    expect(s.aiSystemPrompt).toBe(s.aiSystemPromptDefault);
    expect(s.publicUrl).toBe('https://totes.example.com');
    expect(s.publicUrlCustom).toBe(false);
    expect(JSON.stringify(s)).not.toContain('anthropicApiKey');
  });

  it('stores an API key from the UI (masked in responses) and can clear it', async () => {
    const set = await ctx.agent
      .patch('/api/settings')
      .send({ anthropicApiKey: 'sk-ant-test-1234567890abcd' })
      .expect(200);
    expect(set.body.aiKeySource).toBe('settings');
    expect(set.body.aiKeyHint).toBe('…abcd');
    expect(JSON.stringify(set.body)).not.toContain('sk-ant-test');
    await ctx.agent.patch('/api/settings').send({ anthropicApiKey: 'short' }).expect(400);
    const cleared = await ctx.agent
      .patch('/api/settings')
      .send({ anthropicApiKey: null })
      .expect(200);
    expect(cleared.body.aiKeySource).toBe('none');
  });

  it('custom system prompt is used for analysis and can be reset', async () => {
    const custom = 'You are a terse cataloguer. Reply with JSON only.';
    const set = await ctx.agent.patch('/api/settings').send({ aiSystemPrompt: custom }).expect(200);
    expect(set.body.aiSystemPromptCustom).toBe(true);
    expect(set.body.aiSystemPrompt).toBe(custom);

    await ctx.agent
      .post(`/api/boxes/${boxId}/photos`)
      .attach('photos', await makeJpeg(120, 90), 'p.jpg')
      .expect(201);
    await ctx.app.ai.idle();
    expect(seenPrompts.at(-1)).toBe(custom);

    const reset = await ctx.agent.patch('/api/settings').send({ aiSystemPrompt: null }).expect(200);
    expect(reset.body.aiSystemPromptCustom).toBe(false);
    await ctx.agent.post(`/api/boxes/${boxId}/analyze`).expect(202);
    await ctx.app.ai.idle();
    expect(seenPrompts.at(-1)).toBe(reset.body.aiSystemPromptDefault);
  });

  it('public URL override is validated, applied, and revertible', async () => {
    await ctx.agent.patch('/api/settings').send({ publicUrl: 'totes.example.com' }).expect(400);
    await ctx.agent
      .patch('/api/settings')
      .send({ publicUrl: 'https://x.example.com/path' })
      .expect(400);
    const set = await ctx.agent
      .patch('/api/settings')
      .send({ publicUrl: 'https://boxes.example.org/' })
      .expect(200);
    expect(set.body.publicUrl).toBe('https://boxes.example.org');
    expect(set.body.publicUrlCustom).toBe(true);
    expect(set.body.publicUrlEnv).toBe('https://totes.example.com');
    const back = await ctx.agent.patch('/api/settings').send({ publicUrl: null }).expect(200);
    expect(back.body.publicUrl).toBe('https://totes.example.com');
  });
});
