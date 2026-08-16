import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAnalysis } from '../src/services/ai.js';
import {
  createTestContext,
  makeJpeg,
  seedBasics,
  setupAndLogin,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let boxId: number;
let mode: 'ok' | 'fenced' | 'garbage' | 'error' | 'multi' = 'ok';
const calls: { images: number; model: string }[] = [];

beforeAll(async () => {
  ctx = await createTestContext({
    ai: {
      analyzeOverride: async (images, model) => {
        calls.push({ images: images.length, model });
        switch (mode) {
          case 'ok':
            return JSON.stringify({
              description: 'A tote of holiday lights and ornaments.',
              items: [
                { name: 'String lights', qty: 3, note: 'warm white' },
                { name: 'Glass ornaments', qty: '12', note: null },
                { name: '' },
              ],
            });
          case 'fenced':
            return '```json\n{"description":"Fenced","items":[{"name":"Fenced item","qty":1,"note":""}]}\n```';
          case 'garbage':
            return 'I could not produce JSON but here is prose about a box of cables.';
          case 'multi':
            return JSON.stringify({
              description: 'Combined view.',
              items: [{ name: 'Combined item', qty: 1 }],
            });
          case 'error':
            throw new Error('boom from model');
        }
      },
    },
  });
  await setupAndLogin(ctx);
  const ids = await seedBasics(ctx);
  boxId = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, name: 'Holiday' })).body
    .id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('parseAnalysis', () => {
  it('parses plain and fenced JSON, coerces qty, and falls back on garbage', () => {
    const ok = parseAnalysis('{"description":"d","items":[{"name":"x","qty":"4","note":null}]}');
    expect(ok.parseFailed).toBe(false);
    expect(ok.analysis.items[0]).toEqual({ name: 'x', qty: 4, note: null });
    const fenced = parseAnalysis('```json\n{"description":"d","items":[]}\n```');
    expect(fenced.parseFailed).toBe(false);
    const bad = parseAnalysis('nope');
    expect(bad.parseFailed).toBe(true);
    expect(bad.analysis).toEqual({ description: 'nope', items: [] });
    const wrapped = parseAnalysis('Here you go: {"description":"d","items":[{"name":"y"}]} thanks');
    expect(wrapped.parseFailed).toBe(false);
    expect(wrapped.analysis.items[0]?.qty).toBe(1);
  });
});

describe('photos', () => {
  it('uploads, thumbnails, serves behind auth, reorders and deletes', async () => {
    const jpg = await makeJpeg(1200, 900);
    const res = await ctx.agent
      .post(`/api/boxes/${boxId}/photos`)
      .attach('photos', jpg, 'a.jpg')
      .attach('photos', await makeJpeg(300, 300, { r: 10, g: 200, b: 10 }), 'b.jpg')
      .expect(201);
    expect(res.body.photos).toHaveLength(2);
    expect(res.body.photos[0]).toMatchObject({
      width: 1200,
      height: 900,
      aiStatus: 'pending',
      sortOrder: 0,
    });
    expect(res.body.aiQueued).toBe(true);
    expect(res.body.box.photoCount).toBe(2);
    expect(res.body.box.thumbUrl).toBe(`/api/photos/${res.body.photos[0].id}/thumb`);

    const p1 = res.body.photos[0].id as number;
    const p2 = res.body.photos[1].id as number;

    const thumb = await ctx.agent.get(`/api/photos/${p1}/thumb`).expect(200);
    expect(thumb.headers['content-type']).toMatch(/image\/webp/);
    const orig = await ctx.agent.get(`/api/photos/${p1}/original`).expect(200);
    expect(orig.headers['content-type']).toMatch(/image\/jpeg/);
    await request(ctx.app.app).get(`/api/photos/${p1}/original`).expect(401);

    const files = fs.readdirSync(`${ctx.photoDir}/${boxId}`);
    expect(files.length).toBe(4);

    const reordered = await ctx.agent
      .put(`/api/boxes/${boxId}/photos/reorder`)
      .send({ ids: [p2, p1] })
      .expect(200);
    expect(reordered.body.map((p: { id: number }) => p.id)).toEqual([p2, p1]);

    await ctx.app.ai.idle();
    await ctx.agent.delete(`/api/photos/${p2}`).expect(204);
    expect(fs.readdirSync(`${ctx.photoDir}/${boxId}`).length).toBe(2);
    await ctx.agent.get(`/api/photos/${p2}/thumb`).expect(404);
  });

  it('rejects non-images and oversized files', async () => {
    const bad = await ctx.agent
      .post(`/api/boxes/${boxId}/photos`)
      .attach('photos', Buffer.from('definitely not an image'), 'x.jpg')
      .expect(415);
    expect(bad.body.error.code).toBe('unsupported_media_type');
    const big = Buffer.alloc(21 * 1024 * 1024);
    const tooBig = await ctx.agent
      .post(`/api/boxes/${boxId}/photos`)
      .attach('photos', big, 'big.jpg')
      .expect(413);
    expect(tooBig.body.error.code).toBe('upload_error');
    await ctx.agent.post(`/api/boxes/${boxId}/photos`).expect(400);
  });
});

describe('ai analysis', () => {
  it('auto-analyzes uploads: items appended as source=ai with photo link, description set', async () => {
    await ctx.app.ai.idle();
    const detail = await ctx.agent.get(`/api/boxes/${boxId}`).expect(200);
    expect(detail.body.aiStatus).toBe('done');
    expect(detail.body.aiDescription).toContain('holiday lights');
    const aiItems = detail.body.items.filter((i: { source: string }) => i.source === 'ai');
    // 2 valid items per analyzed photo (empty-name row dropped); the second photo was deleted → its items cascade-removed.
    expect(aiItems.map((i: { name: string; qty: number }) => [i.name, i.qty])).toEqual([
      ['String lights', 3],
      ['Glass ornaments', 12],
    ]);
    expect(aiItems[0].photoId).toBe(detail.body.photos[0].id);
    expect(calls[0]?.model).toBe('test-model');

    // Searchable immediately.
    const search = await ctx.agent.get('/api/search').query({ q: 'ornaments' }).expect(200);
    expect(search.body[0]?.labelId).toBe('A-001');
  });

  it("per-photo re-run replaces that photo's AI items but keeps manual items", async () => {
    const manual = await ctx.agent
      .post(`/api/boxes/${boxId}/items`)
      .send({ name: 'Manual thing' })
      .expect(201);
    const photoId = (await ctx.agent.get(`/api/boxes/${boxId}`)).body.photos[0].id;
    mode = 'fenced';
    await ctx.agent.post(`/api/photos/${photoId}/analyze`).expect(202);
    await ctx.app.ai.idle();
    const detail = await ctx.agent.get(`/api/boxes/${boxId}`).expect(200);
    const names = detail.body.items.map((i: { name: string }) => i.name);
    expect(names).toContain('Fenced item');
    expect(names).toContain('Manual thing');
    expect(names).not.toContain('String lights');
    expect(detail.body.aiDescription).toBe('Fenced');
    await ctx.agent.delete(`/api/items/${manual.body.id}`).expect(204);
  });

  it('box-level re-run sends all photos in one request and replaces all AI rows', async () => {
    await ctx.agent
      .post(`/api/boxes/${boxId}/photos`)
      .attach('photos', await makeJpeg(200, 200), 'c.jpg')
      .expect(201);
    await ctx.app.ai.idle();
    mode = 'multi';
    const before = calls.length;
    await ctx.agent.post(`/api/boxes/${boxId}/analyze`).expect(202);
    await ctx.app.ai.idle();
    expect(calls[before]?.images).toBe(2);
    const detail = await ctx.agent.get(`/api/boxes/${boxId}`).expect(200);
    const aiItems = detail.body.items.filter((i: { source: string }) => i.source === 'ai');
    expect(aiItems).toHaveLength(1);
    expect(aiItems[0]).toMatchObject({ name: 'Combined item', photoId: null });
    expect(detail.body.aiDescription).toBe('Combined view.');
    expect(detail.body.aiStatus).toBe('done');
  });

  it('falls back to description-only when the model returns non-JSON', async () => {
    mode = 'garbage';
    const photoId = (await ctx.agent.get(`/api/boxes/${boxId}`)).body.photos[0].id;
    await ctx.agent.post(`/api/photos/${photoId}/analyze`).expect(202);
    await ctx.app.ai.idle();
    const detail = await ctx.agent.get(`/api/boxes/${boxId}`).expect(200);
    expect(detail.body.aiStatus).toBe('done');
    expect(detail.body.aiError).toMatch(/not valid JSON/);
    expect(detail.body.aiDescription).toContain('prose about a box of cables');
  });

  it('records errors and allows retry', async () => {
    mode = 'error';
    const photoId = (await ctx.agent.get(`/api/boxes/${boxId}`)).body.photos[0].id;
    await ctx.agent.post(`/api/photos/${photoId}/analyze`).expect(202);
    await ctx.app.ai.idle();
    let detail = await ctx.agent.get(`/api/boxes/${boxId}`).expect(200);
    expect(detail.body.aiStatus).toBe('error');
    expect(detail.body.aiError).toContain('boom from model');
    expect(detail.body.photos[0].aiStatus).toBe('error');

    mode = 'ok';
    await ctx.agent.post(`/api/photos/${photoId}/analyze`).expect(202);
    await ctx.app.ai.idle();
    detail = await ctx.agent.get(`/api/boxes/${boxId}`).expect(200);
    expect(detail.body.aiStatus).toBe('done');
    expect(detail.body.aiError).toBeNull();
  });

  it('respects the auto-analyze setting', async () => {
    await ctx.agent.patch('/api/settings').send({ aiAutoAnalyze: false }).expect(200);
    const res = await ctx.agent
      .post(`/api/boxes/${boxId}/photos`)
      .attach('photos', await makeJpeg(100, 100), 'd.jpg')
      .expect(201);
    expect(res.body.aiQueued).toBe(false);
    expect(res.body.photos[0].aiStatus).toBe('none');
    await ctx.agent.patch('/api/settings').send({ aiAutoAnalyze: true }).expect(200);
  });

  it('recovers pending jobs on boot', async () => {
    const photoId = (await ctx.agent.get(`/api/boxes/${boxId}`)).body.photos[0].id;
    // Simulate a crash mid-job: mark pending without queueing.
    await ctx.handle.db.execute(
      (await import('drizzle-orm'))
        .sql`UPDATE photos SET ai_status = 'pending' WHERE id = ${photoId}`,
    );
    // Box also marked pending: it must NOT be re-queued separately while one of its photos is pending
    // (regression: the NOT EXISTS subquery used to compare against photos.id).
    await ctx.handle.db.execute(
      (await import('drizzle-orm')).sql`UPDATE boxes SET ai_status = 'pending' WHERE id = ${boxId}`,
    );
    const n = await ctx.app.ai.recoverPending();
    expect(n).toBe(1);
    await ctx.app.ai.idle();
    const detail = await ctx.agent.get(`/api/boxes/${boxId}`).expect(200);
    expect(detail.body.photos.find((p: { id: number }) => p.id === photoId).aiStatus).toBe('done');
  });
});
