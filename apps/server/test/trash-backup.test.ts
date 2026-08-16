import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeTrash } from '../src/services/trash.js';
import { createPhotoStorage } from '../src/services/photos.js';
import {
  createTestContext,
  makeJpeg,
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

describe('items: move between boxes', () => {
  it('PATCH /items/:id {boxId} moves the item and drops its photo link', async () => {
    const a = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, name: 'From' })).body;
    const b = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, name: 'To' })).body;
    const item = (
      await ctx.agent.post(`/api/boxes/${a.id}/items`).send({ name: 'Lantern' }).expect(201)
    ).body;
    await ctx.agent.patch(`/api/items/${item.id}`).send({ boxId: 999999 }).expect(404);
    const moved = (await ctx.agent.patch(`/api/items/${item.id}`).send({ boxId: b.id }).expect(200))
      .body;
    expect(moved.boxId).toBe(b.id);
    expect(moved.photoId).toBeNull();
    const detailA = (await ctx.agent.get(`/api/boxes/${a.id}`)).body;
    const detailB = (await ctx.agent.get(`/api/boxes/${b.id}`)).body;
    expect(detailA.items).toHaveLength(0);
    expect(detailB.items.map((i: { name: string }) => i.name)).toEqual(['Lantern']);
    // Search follows the item.
    const hits = (await ctx.agent.get('/api/search').query({ q: 'lantern' })).body;
    expect(hits.map((h: { id: number }) => h.id)).toEqual([b.id]);
    // Cannot move into a trashed box.
    await ctx.agent.delete(`/api/boxes/${a.id}`).expect(204);
    await ctx.agent.patch(`/api/items/${item.id}`).send({ boxId: a.id }).expect(409);
  });
});

describe('search paging', () => {
  it('honours limit/offset', async () => {
    for (let i = 0; i < 5; i++)
      await ctx.agent.post('/api/boxes').send({ seriesId: ids.b.id, name: `Paged ${i}` });
    const p1 = (await ctx.agent.get('/api/search').query({ q: 'paged', limit: 2 })).body;
    const p2 = (await ctx.agent.get('/api/search').query({ q: 'paged', limit: 2, offset: 2 })).body;
    const p3 = (await ctx.agent.get('/api/search').query({ q: 'paged', limit: 2, offset: 4 })).body;
    expect(p1).toHaveLength(2);
    expect(p2).toHaveLength(2);
    expect(p3).toHaveLength(1);
    const all = new Set([...p1, ...p2, ...p3].map((r: { id: number }) => r.id));
    expect(all.size).toBe(5);
  });
});

describe('trash expiry', () => {
  it('purges only entries older than the retention period', async () => {
    const box = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.b.id, name: 'Old' })).body;
    await ctx.agent
      .post(`/api/boxes/${box.id}/photos`)
      .attach('photos', await makeJpeg(80, 80), 'a.jpg')
      .expect(201);
    await ctx.app.ai.idle();
    const fresh = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.b.id, name: 'Fresh' }))
      .body;
    await ctx.agent.delete(`/api/boxes/${box.id}`).expect(204);
    await ctx.agent.delete(`/api/boxes/${fresh.id}`).expect(204);
    // Age the first one past 30 days.
    await ctx.handle.db.execute(
      sql`UPDATE boxes SET deleted_at = now() - interval '31 days' WHERE id = ${box.id}`,
    );
    const storage = createPhotoStorage(ctx.photoDir);
    const result = await purgeTrash(ctx.handle.db, storage);
    expect(result.boxes).toBe(1);
    await ctx.agent.get(`/api/boxes/${box.id}`).expect(404);
    expect(
      fs.existsSync(`${ctx.photoDir}/${box.id}`) &&
        fs.readdirSync(`${ctx.photoDir}/${box.id}`).length,
    ).toBeFalsy();
    const stillThere = (await ctx.agent.get(`/api/boxes/${fresh.id}`).expect(200)).body;
    expect(stillThere.deletedAt).not.toBeNull();
    await ctx.agent.post(`/api/boxes/${fresh.id}/restore`).expect(200);
  });
});

describe('backup & restore', () => {
  it('round-trips data and photo files; secrets and PIN are never in the archive', async () => {
    const box = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, name: 'Backup me' }))
      .body;
    await ctx.agent.post(`/api/boxes/${box.id}/items`).send({ name: 'Widget', qty: 3 }).expect(201);
    const up = (
      await ctx.agent
        .post(`/api/boxes/${box.id}/photos`)
        .attach('photos', await makeJpeg(120, 90), 'p.jpg')
        .expect(201)
    ).body;
    await ctx.app.ai.idle();
    await ctx.agent
      .patch('/api/settings')
      .send({ anthropicApiKey: 'sk-ant-secret-key-000000', aiModel: 'model-x' })
      .expect(200);

    const zipRes = await ctx.agent.get('/api/backup').buffer(true).parse(binaryParser as never).expect(200);
    expect(zipRes.headers['content-type']).toMatch(/application\/zip/);
    const zip = zipRes.body as Buffer;
    expect(zip.length).toBeGreaterThan(1000);
    const text = zip.toString('latin1');
    expect(text).toContain('manifest.json');
    expect(text).not.toContain('sk-ant-secret-key');
    expect(text).not.toContain('pin_hash');

    // Mutate everything, then restore.
    const before = (await ctx.agent.get(`/api/boxes/${box.id}`).expect(200)).body;
    await ctx.agent.patch(`/api/boxes/${box.id}`).send({ name: 'Changed' }).expect(200);
    await ctx.agent.delete(`/api/boxes/${box.id}?permanent=true`).expect(204);
    const extra = (await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, name: 'Extra' }))
      .body;
    await ctx.agent.get(`/api/photos/${up.photos[0].id}/thumb`).expect(404);

    await ctx.agent
      .post('/api/backup/restore')
      .field('pin', '0000')
      .attach('backup', zip, 'b.zip')
      .expect(401);
    const res = await ctx.agent
      .post('/api/backup/restore')
      .field('pin', TEST_PIN)
      .attach('backup', zip, 'b.zip')
      .expect(200);
    expect(res.body.restored.boxes).toBeGreaterThan(0);
    expect(res.body.photoFiles).toBeGreaterThanOrEqual(2);
    expect(res.body.missingPhotoFiles).toBe(0);

    // Still logged in (PIN/session untouched); data back as it was; extra box gone.
    const after = (await ctx.agent.get(`/api/boxes/${box.id}`).expect(200)).body;
    expect(after.name).toBe('Backup me');
    expect(after.items.map((i: { name: string; qty: number }) => [i.name, i.qty])).toEqual([
      ['Widget', 3],
    ]);
    expect(after.photos).toHaveLength(1);
    expect(after.photos[0].id).toBe(before.photos[0].id);
    await ctx.agent.get(`/api/photos/${up.photos[0].id}/thumb`).expect(200);
    await ctx.agent.get(`/api/boxes/${extra.id}`).expect(404);
    const settings = (await ctx.agent.get('/api/settings').expect(200)).body;
    expect(settings.aiModel).toBe('model-x');
    expect(settings.aiKeyHint).toBe('…0000'); // secret survived because it wasn't in the archive
    // Search works after restore and ids/sequences are sane: a new box gets a fresh id.
    const hits = (await ctx.agent.get('/api/search').query({ q: 'widget' })).body;
    expect(hits.map((h: { id: number }) => h.id)).toEqual([box.id]);
    await ctx.agent.post('/api/boxes').send({ seriesId: ids.a.id, name: 'After' }).expect(201);

    // Garbage in → 400, data untouched.
    await ctx.agent
      .post('/api/backup/restore')
      .field('pin', TEST_PIN)
      .attach('backup', Buffer.from('not a zip'), 'x.zip')
      .expect(400);
    await ctx.agent.get(`/api/boxes/${box.id}`).expect(200);
  });
});

function binaryParser(
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
