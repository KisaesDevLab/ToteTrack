import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestContext,
  seedBasics,
  setupAndLogin,
  TEST_PIN,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let ids: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  ctx = await createTestContext();
  await setupAndLogin(ctx);
  ids = await seedBasics(ctx);
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('series', () => {
  it('validates letters and enforces uniqueness', async () => {
    await ctx.agent.post('/api/series').send({ letter: 'AB' }).expect(400);
    await ctx.agent.post('/api/series').send({ letter: '1' }).expect(400);
    const dup = await ctx.agent.post('/api/series').send({ letter: 'a' }).expect(409);
    expect(dup.body.error.code).toBe('conflict');
    const list = await ctx.agent.get('/api/series').expect(200);
    expect(list.body.map((s: { letter: string }) => s.letter)).toEqual(['A', 'B']);
  });

  it('cannot lower next_number below the highest used number', async () => {
    const box = await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id }).expect(201);
    expect(box.body.labelId).toBe('A-001');
    await ctx.agent.patch(`/api/series/${ids.a.id}`).send({ nextNumber: 1 }).expect(400);
    const ok = await ctx.agent
      .patch(`/api/series/${ids.a.id}`)
      .send({ nextNumber: 10, description: 'x' })
      .expect(200);
    expect(ok.body.nextNumber).toBe(10);
    const next = await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id }).expect(201);
    expect(next.body.labelId).toBe('A-010');
    await ctx.agent.delete(`/api/series/${ids.a.id}`).expect(409); // has boxes
  });
});

describe('locations', () => {
  it('counts boxes per location and per series correctly (correlated subquery regression)', async () => {
    // Two boxes (own series C so other tests' numbering is untouched) in Attic; ids differ from
    // the location/series ids → counts must still be 2.
    const c = (await ctx.agent.post('/api/series').send({ letter: 'C' }).expect(201)).body;
    const b1 = (
      await ctx.agent.post('/api/boxes').send({ seriesId: c.id, locationId: ids.attic.id })
    ).body;
    const b2 = (
      await ctx.agent.post('/api/boxes').send({ seriesId: c.id, locationId: ids.attic.id })
    ).body;
    const locs = (await ctx.agent.get('/api/locations').expect(200)).body;
    expect(locs.find((l: { id: number }) => l.id === ids.attic.id).boxCount).toBe(2);
    expect(locs.find((l: { id: number }) => l.id === ids.garage.id).boxCount).toBe(0);
    const series = (await ctx.agent.get('/api/series').expect(200)).body;
    expect(series.find((s: { id: number }) => s.id === c.id).boxCount).toBe(2);
    // Trashed boxes drop out of the counts but still block a series delete until purged.
    await ctx.agent.delete(`/api/boxes/${b1.id}`).expect(204);
    await ctx.agent.delete(`/api/boxes/${b2.id}`).expect(204);
    const after = (await ctx.agent.get('/api/locations').expect(200)).body;
    expect(after.find((l: { id: number }) => l.id === ids.attic.id).boxCount).toBe(0);
    await ctx.agent.delete(`/api/series/${c.id}`).expect(409);
    await ctx.agent.delete(`/api/boxes/${b1.id}?permanent=true`).expect(204);
    await ctx.agent.delete(`/api/boxes/${b2.id}?permanent=true`).expect(204);
    await ctx.agent.delete(`/api/series/${c.id}`).expect(204);
  });

  it('CRUD + reorder + unique', async () => {
    const dup = await ctx.agent.post('/api/locations').send({ name: 'Garage' }).expect(409);
    expect(dup.body.error.code).toBe('conflict');
    const shed = (await ctx.agent.post('/api/locations').send({ name: 'Shed' }).expect(201)).body;
    await ctx.agent
      .put('/api/locations/reorder')
      .send({ ids: [shed.id, ids.attic.id, ids.garage.id] })
      .expect(200);
    const list = await ctx.agent.get('/api/locations').expect(200);
    expect(list.body.map((l: { name: string }) => l.name)).toEqual(['Shed', 'Attic', 'Garage']);
    await ctx.agent.patch(`/api/locations/${shed.id}`).send({ name: 'Garden shed' }).expect(200);
    await ctx.agent.delete(`/api/locations/${shed.id}`).expect(204);
    await ctx.agent.delete(`/api/locations/${shed.id}`).expect(404);
  });
});

describe('boxes', () => {
  it('creates with auto-incrementing labels, updates, toggles and deletes', async () => {
    const created = await ctx.agent
      .post('/api/boxes')
      .send({ seriesId: ids.b.id, name: 'Holiday', locationId: ids.attic.id })
      .expect(201);
    expect(created.body).toMatchObject({
      labelId: 'B-001',
      seriesLetter: 'B',
      number: 1,
      name: 'Holiday',
      locationName: 'Attic',
      status: 'open',
      photoCount: 0,
      itemCount: 0,
    });
    const id = created.body.id as number;

    const patched = await ctx.agent
      .patch(`/api/boxes/${id}`)
      .send({ name: 'Holiday stuff', locationId: null })
      .expect(200);
    expect(patched.body.name).toBe('Holiday stuff');
    expect(patched.body.locationId).toBeNull();

    const toggled = await ctx.agent.post(`/api/boxes/${id}/toggle-status`).expect(200);
    expect(toggled.body.status).toBe('sealed');

    const detail = await ctx.agent.get(`/api/boxes/${id}`).expect(200);
    expect(detail.body.photos).toEqual([]);
    expect(detail.body.items).toEqual([]);

    const byLabel = await ctx.agent.get('/api/boxes/by-label/b1').expect(200);
    expect(byLabel.body.id).toBe(id);
    await ctx.agent.get('/api/boxes/by-label/b-002').expect(404);
    await ctx.agent.get('/api/boxes/by-label/zzz').expect(400);

    await ctx.agent.patch(`/api/boxes/${id}`).send({ locationId: 99999 }).expect(400);
    await ctx.agent.post('/api/boxes').send({ seriesId: 99999 }).expect(400);

    // Delete = move to Trash: hidden from lists/lookups, restorable, then gone for good on purge.
    await ctx.agent.delete(`/api/boxes/${id}`).expect(204);
    const trashed = (await ctx.agent.get(`/api/boxes/${id}`).expect(200)).body;
    expect(trashed.deletedAt).not.toBeNull();
    expect(
      (await ctx.agent.get('/api/boxes').expect(200)).body.some((b: { id: number }) => b.id === id),
    ).toBe(false);
    await ctx.agent.get('/api/boxes/by-label/b1').expect(404);
    const lookup = (await ctx.agent.get('/api/labels/lookup/B-001').expect(200)).body;
    expect(lookup.box).toBeNull();
    expect(lookup.trashedBox?.id).toBe(id);
    // The number stays reserved while the box is in the Trash.
    const clash = await ctx.agent
      .post('/api/boxes')
      .send({ seriesId: ids.b.id, number: 1 })
      .expect(409);
    expect(clash.body.error.details?.trashedBoxId).toBe(id);
    const trash = (await ctx.agent.get('/api/trash').expect(200)).body;
    expect(trash.boxes.map((b: { id: number }) => b.id)).toContain(id);
    expect(trash.retentionDays).toBe(30);
    const restored = (await ctx.agent.post(`/api/boxes/${id}/restore`).expect(200)).body;
    expect(restored.deletedAt).toBeNull();
    await ctx.agent.get('/api/boxes/by-label/b1').expect(200);
    await ctx.agent.post(`/api/boxes/${id}/restore`).expect(404); // not in the Trash any more

    await ctx.agent.delete(`/api/boxes/${id}`).expect(204);
    await ctx.agent.delete('/api/trash').expect(200); // empty the Trash
    await ctx.agent.get(`/api/boxes/${id}`).expect(404);
  });

  it('bulk edits: set location / seal / open / trash', async () => {
    const mk = async () =>
      (await ctx.agent.post('/api/boxes').send({ seriesId: ids.b.id }).expect(201)).body
        .id as number;
    const [x, y] = [await mk(), await mk()];
    await ctx.agent
      .post('/api/boxes/bulk')
      .send({ ids: [x, y], action: 'setLocation' })
      .expect(400); // locationId required
    let r = await ctx.agent
      .post('/api/boxes/bulk')
      .send({ ids: [x, y], action: 'setLocation', locationId: ids.garage.id })
      .expect(200);
    expect(r.body.updated).toBe(2);
    r = await ctx.agent
      .post('/api/boxes/bulk')
      .send({ ids: [x, y], action: 'seal' })
      .expect(200);
    expect(r.body.updated).toBe(2);
    const bx = (await ctx.agent.get(`/api/boxes/${x}`).expect(200)).body;
    expect(bx).toMatchObject({ status: 'sealed', locationId: ids.garage.id });
    r = await ctx.agent
      .post('/api/boxes/bulk')
      .send({ ids: [x], action: 'open' })
      .expect(200);
    expect(r.body.updated).toBe(1);
    r = await ctx.agent
      .post('/api/boxes/bulk')
      .send({ ids: [x, y], action: 'trash' })
      .expect(200);
    expect(r.body.updated).toBe(2);
    // Trashed boxes are skipped by further bulk edits.
    r = await ctx.agent
      .post('/api/boxes/bulk')
      .send({ ids: [x, y], action: 'seal' })
      .expect(200);
    expect(r.body.updated).toBe(0);
    await ctx.agent.delete(`/api/boxes/${x}?permanent=true`).expect(204);
    await ctx.agent.delete(`/api/boxes/${y}?permanent=true`).expect(204);
  });

  it('assigns unique numbers under concurrent creation', async () => {
    // One real listening server + fetch: 25 truly concurrent requests against the same process
    // (supertest spins up a listener per request, which is flaky under parallel load on CI).
    const server = await new Promise<http.Server>((resolve) => {
      const srv = ctx.app.app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    try {
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const results = await Promise.all(
        Array.from({ length: 25 }, async () => {
          const res = await fetch(`${base}/api/boxes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ seriesId: ids.b.id }),
          });
          return {
            status: res.status,
            body: (await res.json()) as { labelId: string; number: number },
          };
        }),
      );
      for (const r of results) expect(r.status).toBe(201);
      const labels = results.map((r) => r.body.labelId);
      expect(new Set(labels).size).toBe(25);
      const numbers = results.map((r) => r.body.number).sort((a, b) => a - b);
      // A contiguous run — no gaps, no duplicates.
      expect(numbers[numbers.length - 1]! - numbers[0]!).toBe(24);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('list filters and sorting', async () => {
    const all = await ctx.agent.get('/api/boxes').expect(200);
    expect(all.body.length).toBeGreaterThan(20);
    const bOnly = await ctx.agent.get(`/api/boxes?seriesId=${ids.b.id}&limit=5`).expect(200);
    expect(bOnly.body).toHaveLength(5);
    expect(bOnly.body.every((b: { seriesLetter: string }) => b.seriesLetter === 'B')).toBe(true);
    const sealed = await ctx.agent.get('/api/boxes?status=sealed').expect(200);
    expect(sealed.body).toHaveLength(0);
    await ctx.agent.get('/api/boxes?limit=abc').expect(400);
  });
});
