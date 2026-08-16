import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestContext,
  makeJpeg,
  seedBasics,
  setupAndLogin,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let ids: Awaited<ReturnType<typeof seedBasics>>;
const calls: number[] = [];
let mode: 'first' | 'second' = 'first';

beforeAll(async () => {
  ctx = await createTestContext({
    ai: {
      analyzeOverride: async (images) => {
        calls.push(images.length);
        return mode === 'first'
          ? JSON.stringify({
              description: 'Winter clothes.',
              items: [
                { name: 'Wool coat', qty: 1 },
                { name: 'Scarves', qty: 3 },
              ],
            })
          : JSON.stringify({
              description: 'Now holds camping gear.',
              items: [{ name: 'Tent', qty: 1 }],
            });
      },
    },
  });
  await setupAndLogin(ctx);
  ids = await seedBasics(ctx);
});
afterAll(async () => {
  await ctx.cleanup();
});

const pdfBuffer = (req: ReturnType<TestContext['agent']['post']>) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('pre-printed labels', () => {
  it('reserves numbers, prints them, and scanning claims them', async () => {
    // A-001 exists as a normal box first.
    const first = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, name: 'First' }))
      .body;
    expect(first.labelId).toBe('A-001');

    const res = await pdfBuffer(
      ctx.agent
        .post('/api/labels/preprint')
        .send({ seriesId: ids.a.id, count: 5, templateId: 'label-4x3' }),
    ).expect(200);
    expect(res.headers['content-disposition']).toContain('totetrack-preprint-A-002-A-006.pdf');
    expect((await PDFDocument.load(res.body as Buffer)).getPageCount()).toBe(5);

    const list = (await ctx.agent.get('/api/labels/preprinted?unclaimed=true').expect(200)).body;
    expect(list.map((l: { labelId: string }) => l.labelId)).toEqual([
      'A-002',
      'A-003',
      'A-004',
      'A-005',
      'A-006',
    ]);
    const series = (await ctx.agent.get('/api/series').expect(200)).body.find(
      (s: { id: number }) => s.id === ids.a.id,
    );
    expect(series.unclaimedLabels).toBe(5);
    expect(series.nextNumber).toBe(7); // reserved range is skipped by auto-numbering

    // A new auto-numbered box does not collide with the pre-printed range.
    const auto = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id })).body;
    expect(auto.labelId).toBe('A-007');

    // Scan A-004 → lookup says pre-printed & unclaimed, no box yet.
    const lookup = (await ctx.agent.get('/api/labels/lookup/a4').expect(200)).body;
    expect(lookup.box).toBeNull();
    expect(lookup.preprinted).toMatchObject({ labelId: 'A-004', claimedBoxId: null });
    expect(lookup.seriesId).toBe(ids.a.id);

    // Creating the box with that number claims the label.
    const created = (
      await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, number: 4 }).expect(201)
    ).body;
    expect(created.labelId).toBe('A-004');
    expect(created.printedAt).not.toBeNull(); // the label is already on the tote
    const after = (await ctx.agent.get('/api/labels/lookup/A-004').expect(200)).body;
    expect(after.box.id).toBe(created.id);
    expect(after.preprinted.claimedBoxId).toBe(created.id);
    expect(
      (await ctx.agent.get('/api/series')).body.find((s: { id: number }) => s.id === ids.a.id)
        .unclaimedLabels,
    ).toBe(4);
    await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, number: 4 }).expect(409);

    // Void a misprint; claimed ones cannot be voided.
    const a6 = list.find((l: { labelId: string }) => l.labelId === 'A-006');
    await ctx.agent.delete(`/api/labels/preprinted/${a6.id}`).expect(204);
    const a4 = list.find((l: { labelId: string }) => l.labelId === 'A-004');
    await ctx.agent.delete(`/api/labels/preprinted/${a4.id}`).expect(404);

    // Deleting the box returns its pre-printed label to the waiting pool; series delete is blocked
    // while labels are waiting.
    await ctx.agent.delete(`/api/boxes/${created.id}`).expect(204);
    const back = (await ctx.agent.get('/api/labels/lookup/A-004').expect(200)).body;
    expect(back.box).toBeNull();
    expect(back.preprinted.claimedBoxId).toBeNull();
    expect(back.preprinted.claimedAt).toBeNull();
    const blocked = await ctx.agent.delete(`/api/series/${ids.a.id}`).expect(409);
    expect(blocked.body.error.message).toMatch(/pre-printed|boxes/);

    // Next number cannot be lowered into the reserved (pre-printed) range.
    await ctx.agent.patch(`/api/series/${ids.a.id}`).send({ nextNumber: 5 }).expect(400);
    await ctx.agent.patch(`/api/series/${ids.a.id}`).send({ nextNumber: 8 }).expect(200);

    // Unknown label in a known series / unknown series.
    const unknown = (await ctx.agent.get('/api/labels/lookup/A-050').expect(200)).body;
    expect(unknown).toMatchObject({ box: null, preprinted: null, seriesId: ids.a.id });
    const noSeries = (await ctx.agent.get('/api/labels/lookup/Z-001').expect(200)).body;
    expect(noSeries.seriesId).toBeNull();
    await ctx.agent.get('/api/labels/lookup/nope').expect(400);
  });
});

describe('rescan', () => {
  it('replaces photos + AI items with a fresh box-level analysis, keeping manual items', async () => {
    const box = (
      await ctx.agent.post('/api/boxes').send({ seriesId: ids.b.id, name: 'Closet tote' })
    ).body;
    await ctx.agent.post(`/api/boxes/${box.id}/items`).send({ name: 'Manual note' }).expect(201);
    await ctx.agent
      .post(`/api/boxes/${box.id}/photos`)
      .attach('photos', await makeJpeg(200, 150), 'a.jpg')
      .expect(201);
    await ctx.app.ai.idle();
    let detail = (await ctx.agent.get(`/api/boxes/${box.id}`)).body;
    expect(detail.items.map((i: { name: string }) => i.name).sort()).toEqual([
      'Manual note',
      'Scarves',
      'Wool coat',
    ]);
    expect(detail.aiDescription).toBe('Winter clothes.');
    const oldPhotoId = detail.photos[0].id;

    mode = 'second';
    const before = calls.length;
    const res = await ctx.agent
      .post(`/api/boxes/${box.id}/rescan`)
      .attach('photos', await makeJpeg(210, 160, { r: 20, g: 120, b: 220 }), 'new1.jpg')
      .attach('photos', await makeJpeg(210, 160, { r: 220, g: 20, b: 20 }), 'new2.jpg')
      .expect(201);
    expect(res.body.replaced).toBe(true);
    expect(res.body.aiQueued).toBe(true);
    expect(res.body.photos).toHaveLength(2);
    await ctx.app.ai.idle();
    expect(calls[before]).toBe(2); // one box-level request with both photos

    detail = (await ctx.agent.get(`/api/boxes/${box.id}`)).body;
    expect(detail.photos.map((p: { id: number }) => p.id)).not.toContain(oldPhotoId);
    expect(detail.photos).toHaveLength(2);
    expect(detail.items.map((i: { name: string }) => i.name).sort()).toEqual([
      'Manual note',
      'Tent',
    ]);
    expect(detail.aiDescription).toBe('Now holds camping gear.');
    await ctx.agent.get(`/api/photos/${oldPhotoId}/thumb`).expect(404);

    // replace=false keeps existing photos and appends.
    await ctx.agent
      .post(`/api/boxes/${box.id}/rescan`)
      .field('replace', 'false')
      .attach('photos', await makeJpeg(100, 100), 'extra.jpg')
      .expect(201);
    await ctx.app.ai.idle();
    detail = (await ctx.agent.get(`/api/boxes/${box.id}`)).body;
    expect(detail.photos).toHaveLength(3);
    await ctx.agent.post(`/api/boxes/${box.id}/rescan`).expect(400);

    // A rescan whose upload is invalid must NOT wipe the existing photos.
    const bad = await ctx.agent
      .post(`/api/boxes/${box.id}/rescan`)
      .attach('photos', await makeJpeg(90, 90), 'ok.jpg')
      .attach('photos', Buffer.from('not an image at all'), 'junk.jpg')
      .expect(415);
    expect(bad.body.error.code).toBe('unsupported_media_type');
    detail = (await ctx.agent.get(`/api/boxes/${box.id}`)).body;
    expect(detail.photos).toHaveLength(3);
  });
});
