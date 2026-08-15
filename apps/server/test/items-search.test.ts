import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, seedBasics, setupAndLogin, type TestContext } from './helpers.js';

let ctx: TestContext;
let ids: Awaited<ReturnType<typeof seedBasics>>;
let camping: number;
let kitchen: number;

beforeAll(async () => {
  ctx = await createTestContext();
  await setupAndLogin(ctx);
  ids = await seedBasics(ctx);
  camping = (
    await ctx.agent
      .post('/api/boxes')
      .send({ seriesId: ids.a.id, name: 'Camping gear', locationId: ids.garage.id })
  ).body.id;
  kitchen = (
    await ctx.agent
      .post('/api/boxes')
      .send({ seriesId: ids.a.id, name: 'Kitchen overflow', locationId: ids.attic.id })
  ).body.id;
  for (let i = 0; i < 12; i++) await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('items', () => {
  it('create / update / delete / bulk delete', async () => {
    const tent = (
      await ctx.agent
        .post(`/api/boxes/${camping}/items`)
        .send({ name: 'Two-person tent', qty: 1, note: 'Green' })
        .expect(201)
    ).body;
    expect(tent).toMatchObject({
      name: 'Two-person tent',
      qty: 1,
      note: 'Green',
      source: 'manual',
      photoId: null,
    });
    await ctx.agent
      .post(`/api/boxes/${camping}/items`)
      .send({ name: 'Headlamp', note: 'Needs AAA batteries' })
      .expect(201);
    await ctx.agent
      .post(`/api/boxes/${kitchen}/items`)
      .send({ name: 'Slow cooker', note: 'Crock-Pot 6qt' })
      .expect(201);
    await ctx.agent.post(`/api/boxes/${camping}/items`).send({ name: '' }).expect(400);

    const upd = await ctx.agent
      .patch(`/api/items/${tent.id}`)
      .send({ qty: 2, note: null })
      .expect(200);
    expect(upd.body.qty).toBe(2);
    expect(upd.body.note).toBeNull();

    const list = await ctx.agent.get(`/api/boxes/${camping}/items`).expect(200);
    expect(list.body).toHaveLength(2);
    const summary = await ctx.agent.get(`/api/boxes/${camping}`).expect(200);
    expect(summary.body.itemCount).toBe(2);

    const extra = (
      await ctx.agent.post(`/api/boxes/${camping}/items`).send({ name: 'Temp' }).expect(201)
    ).body;
    await ctx.agent.delete(`/api/items/${extra.id}`).expect(204);
    await ctx.agent.delete(`/api/items/${extra.id}`).expect(404);

    const bulk = await ctx.agent.delete(`/api/boxes/${camping}/items?source=ai`).expect(200);
    expect(bulk.body.deleted).toBe(0); // no AI items yet
  });
});

describe('search', () => {
  it('finds boxes by item name, note, box name, location and description', async () => {
    await ctx.agent
      .patch(`/api/boxes/${camping}`)
      .send({ aiDescription: 'Outdoor equipment for weekend trips including a stove.' });

    const q = async (term: string) =>
      (await ctx.agent.get('/api/search').query({ q: term }).expect(200)).body as Array<{
        labelId: string;
        matchedFields: string[];
        headline: string | null;
      }>;

    expect((await q('tent')).map((r) => r.labelId)).toEqual(['A-001']);
    expect((await q('tents'))[0]?.labelId).toBe('A-001'); // stemming
    expect((await q('crock'))[0]?.labelId).toBe('A-002'); // note, trigram
    expect((await q('Kitchen'))[0]?.labelId).toBe('A-002');
    expect((await q('attic'))[0]?.matchedFields).toContain('location');
    const desc = await q('stove');
    expect(desc[0]?.labelId).toBe('A-001');
    expect(desc[0]?.matchedFields).toContain('description');
    expect(desc[0]?.headline).toContain('<b>stove</b>');
    expect(await q('unicorn')).toEqual([]);
  });

  it('supports partial and exact label matches', async () => {
    const q = async (term: string) =>
      (
        (await ctx.agent.get('/api/search').query({ q: term }).expect(200)).body as Array<{
          labelId: string;
        }>
      ).map((r) => r.labelId);
    expect(await q('A-1')).toEqual(
      expect.arrayContaining(['A-001', 'A-010', 'A-011', 'A-012', 'A-013', 'A-014']),
    );
    expect((await q('A-1'))[0]).toBe('A-001'); // exact match ranks first
    expect((await q('a12'))[0]).toBe('A-012');
    expect(await q('B-1')).toEqual([]);
  });

  it('applies filters and returns recent boxes for an empty query', async () => {
    const empty = await ctx.agent.get('/api/search').expect(200);
    expect(empty.body.length).toBeGreaterThan(2);
    const filtered = await ctx.agent
      .get('/api/search')
      .query({ q: '', locationId: ids.attic.id })
      .expect(200);
    expect(filtered.body.map((b: { labelId: string }) => b.labelId)).toEqual(['A-002']);
    await ctx.agent.post(`/api/boxes/${kitchen}/toggle-status`).expect(200);
    const sealed = await ctx.agent
      .get('/api/search')
      .query({ q: 'kitchen', status: 'sealed' })
      .expect(200);
    expect(sealed.body).toHaveLength(1);
    const open = await ctx.agent
      .get('/api/search')
      .query({ q: 'kitchen', status: 'open' })
      .expect(200);
    expect(open.body).toHaveLength(0);
  });
});
