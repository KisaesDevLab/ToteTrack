import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { qrPayload } from '../src/services/labels.js';
import { createTestContext, seedBasics, setupAndLogin, type TestContext } from './helpers.js';

let ctx: TestContext;
const boxIds: number[] = [];

beforeAll(async () => {
  ctx = await createTestContext();
  await setupAndLogin(ctx);
  const ids = await seedBasics(ctx);
  for (const name of ['Alpha, "quoted"', '=SUM(1)', null]) {
    boxIds.push(
      (
        await ctx.agent
          .post('/api/boxes')
          .send({ seriesId: ids.a.id, name, locationId: ids.garage.id })
      ).body.id,
    );
  }
  await ctx.agent
    .post(`/api/boxes/${boxIds[0]}/items`)
    .send({ name: 'Line\nbreak', qty: 2, note: 'has, comma' });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('labels', () => {
  it('lists templates and renders calibration + label PDFs, marking boxes printed', () => {
    expect(qrPayload('https://totes.example.com/', 'A-001')).toBe(
      'https://totes.example.com/b/A-001',
    );
  });

  it('templates endpoint', async () => {
    const res = await ctx.agent.get('/api/labels/templates').expect(200);
    expect(res.body.defaultTemplateId).toBe('avery-5163');
    expect(res.body.templates.map((t: { id: string }) => t.id)).toContain('avery-5163');
  });

  it('calibration PDF', async () => {
    const res = await ctx.agent.get('/api/labels/calibration').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('label PDF with offset marks printed and respects unprinted filter', async () => {
    const before = await ctx.agent.get('/api/boxes?unprinted=true').expect(200);
    expect(before.body).toHaveLength(3);
    const res = await ctx.agent
      .post('/api/labels/pdf')
      .send({ boxIds: [boxIds[2], boxIds[0]], startOffset: 9 })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Offset 9 on a 10-per-sheet template + 2 labels → 2 pages.
    const pdf = await PDFDocument.load(res.body as Buffer);
    expect(pdf.getPageCount()).toBe(2);
    const after = await ctx.agent.get('/api/boxes?unprinted=true').expect(200);
    expect(after.body.map((b: { id: number }) => b.id)).toEqual([boxIds[1]]);
    await ctx.agent
      .post('/api/labels/pdf')
      .send({ boxIds: [999999] })
      .expect(400);
    await ctx.agent.post('/api/labels/pdf').send({ boxIds: [] }).expect(400);
  });
});

describe('export', () => {
  it('boxes.csv and items.csv escape correctly', async () => {
    const boxesCsv = await ctx.agent.get('/api/export/boxes.csv').expect(200);
    expect(boxesCsv.headers['content-type']).toMatch(/text\/csv/);
    const text = boxesCsv.text.replace(/^\uFEFF/, '');
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe(
      'label,name,location,status,description,photo_count,item_count,created_at,updated_at',
    );
    expect(lines[1]).toContain('A-001,"Alpha, ""quoted""",Garage,open,,0,1,');
    expect(lines[2]).toContain("A-002,'=SUM(1),Garage"); // formula neutralised
    expect(lines[3]).toContain('A-003,,Garage');

    const itemsCsv = await ctx.agent.get('/api/export/items.csv').expect(200);
    const itext = itemsCsv.text.replace(/^\uFEFF/, '');
    expect(itext).toContain('label,box_name,location,item,qty,note,source');
    expect(itext).toContain('"Line\nbreak",2,"has, comma",manual');

    const inv = await ctx.agent.get('/api/export/inventory.csv').expect(200);
    const ilines = inv.text
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .filter(Boolean);
    expect(ilines[0]).toBe('label,box_name,location,status,description,item,qty,note,source');
    expect(inv.text).toContain(
      'A-001,"Alpha, ""quoted""",Garage,open,,"Line\nbreak",2,"has, comma",manual',
    );
    // boxes without items still appear, with empty item columns
    expect(ilines.some((l) => l.startsWith('A-003,,Garage,open,,,,,'))).toBe(true);
  });
});

describe('single-label templates (sheet-feed printers)', () => {
  it('lists the 4x3 / 3x4 templates and renders one page per label', async () => {
    const res = await ctx.agent.get('/api/labels/templates').expect(200);
    const ids = res.body.templates.map((t: { id: string; perSheet: number }) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['label-4x3', 'label-3x4']));
    const t = res.body.templates.find((x: { id: string }) => x.id === 'label-4x3');
    expect(t.perSheet).toBe(1);

    const pdfRes = await ctx.agent
      .post('/api/labels/pdf')
      .send({ boxIds: boxIds.slice(0, 3), templateId: 'label-4x3', markPrinted: false })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const pdf = await PDFDocument.load(pdfRes.body as Buffer);
    expect(pdf.getPageCount()).toBe(3);
    const { width, height } = pdf.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([288, 216]); // 4in × 3in at 72pt/in
  });
});
