import type { BoxSummary, LabelTemplate } from '@totetrack/shared';

/** What a label needs: the ID and an optional name line. Works for boxes and pre-printed labels. */
export type LabelSubject = Pick<BoxSummary, 'labelId' | 'name'>;
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

const IN = 72; // points per inch

/** Geometry for a sheet of die-cut labels. All values in inches. */
export interface LabelTemplateSpec extends LabelTemplate {
  pageWidth: number;
  pageHeight: number;
  labelWidth: number;
  labelHeight: number;
  marginTop: number;
  marginLeft: number;
  pitchX: number;
  pitchY: number;
  /** Layout hints */
  qrSize: number;
  labelFontSize: number;
  nameFontSize: number;
  padding: number;
  /** `row`: QR left, text right (wide labels). `stack`: label ID on top, QR centred, name below (tall labels). */
  layout?: 'row' | 'stack';
}

export const LABEL_TEMPLATES: Record<string, LabelTemplateSpec> = {
  'avery-5163': {
    id: 'avery-5163',
    name: 'Avery 5163 (2" × 4", 10 per sheet)',
    description: 'US Letter, 2 columns × 5 rows. Also matches 8163, 5263, 5963, 48163.',
    perSheet: 10,
    columns: 2,
    rows: 5,
    pageWidth: 8.5,
    pageHeight: 11,
    labelWidth: 4,
    labelHeight: 2,
    marginTop: 0.5,
    marginLeft: 0.15625,
    pitchX: 4.1875,
    pitchY: 2,
    qrSize: 1.55,
    labelFontSize: 40,
    nameFontSize: 12,
    padding: 0.18,
  },
  'avery-5160': {
    id: 'avery-5160',
    name: 'Avery 5160 (1" × 2-5/8", 30 per sheet)',
    description: 'US Letter, 3 columns × 10 rows. Also matches 8160, 5260, 5960.',
    perSheet: 30,
    columns: 3,
    rows: 10,
    pageWidth: 8.5,
    pageHeight: 11,
    labelWidth: 2.625,
    labelHeight: 1,
    marginTop: 0.5,
    marginLeft: 0.1875,
    pitchX: 2.75,
    pitchY: 1,
    qrSize: 0.8,
    labelFontSize: 18,
    nameFontSize: 7,
    padding: 0.1,
  },
  // Single-label stock for sheet-feed / roll label printers: one label per page.
  'label-4x3': {
    id: 'label-4x3',
    name: '4" × 3" label (one per page, landscape)',
    description:
      'For sheet-feed label printers loaded with 4"-wide × 3"-tall stock. Each label is its own page; print at 100% with no margins.',
    perSheet: 1,
    columns: 1,
    rows: 1,
    pageWidth: 4,
    pageHeight: 3,
    labelWidth: 4,
    labelHeight: 3,
    marginTop: 0,
    marginLeft: 0,
    pitchX: 4,
    pitchY: 3,
    qrSize: 1.55,
    labelFontSize: 58,
    nameFontSize: 15,
    padding: 0.2,
    layout: 'stack',
  },
  'label-3x4': {
    id: 'label-3x4',
    name: '3" × 4" label (one per page, portrait)',
    description:
      'Same stock fed the other way (3" wide × 4" tall). Each label is its own page; print at 100% with no margins.',
    perSheet: 1,
    columns: 1,
    rows: 1,
    pageWidth: 3,
    pageHeight: 4,
    labelWidth: 3,
    labelHeight: 4,
    marginTop: 0,
    marginLeft: 0,
    pitchX: 3,
    pitchY: 4,
    qrSize: 2.1,
    labelFontSize: 48,
    nameFontSize: 14,
    padding: 0.2,
    layout: 'stack',
  },
};

export const DEFAULT_LABEL_TEMPLATE = 'avery-5163';

export function listTemplates(): LabelTemplate[] {
  return Object.values(LABEL_TEMPLATES).map(
    ({ id, name, description, perSheet, columns, rows }) => ({
      id,
      name,
      description,
      perSheet,
      columns,
      rows,
    }),
  );
}

export function getTemplate(id: string | undefined): LabelTemplateSpec {
  return LABEL_TEMPLATES[id ?? DEFAULT_LABEL_TEMPLATE] ?? LABEL_TEMPLATES[DEFAULT_LABEL_TEMPLATE]!;
}

/** Bottom-left origin (PDF coordinates) of the label at `index` on a page. */
function cellOrigin(t: LabelTemplateSpec, index: number): { x: number; y: number } {
  const col = index % t.columns;
  const row = Math.floor(index / t.columns);
  const x = (t.marginLeft + col * t.pitchX) * IN;
  const yTop = (t.marginTop + row * t.pitchY) * IN; // from top
  const y = t.pageHeight * IN - yTop - t.labelHeight * IN;
  return { x, y };
}

export function qrPayload(publicUrl: string, labelId: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/b/${encodeURIComponent(labelId)}`;
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export interface LabelPdfOptions {
  templateId?: string;
  startOffset?: number;
  includeName?: boolean;
  publicUrl: string;
}

export async function renderLabelsPdf(
  boxesToPrint: LabelSubject[],
  opts: LabelPdfOptions,
): Promise<Uint8Array> {
  const t = getTemplate(opts.templateId);
  const startOffset = Math.max(0, Math.min(opts.startOffset ?? 0, t.perSheet - 1));
  const includeName = opts.includeName ?? true;

  const doc = await PDFDocument.create();
  doc.setTitle('ToteTrack labels');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  let page: PDFPage | undefined;
  let slot = 0;
  let firstPage = true;

  for (const box of boxesToPrint) {
    if (!page || slot >= t.perSheet) {
      page = doc.addPage([t.pageWidth * IN, t.pageHeight * IN]);
      slot = firstPage ? startOffset : 0;
      firstPage = false;
    }
    const { x, y } = cellOrigin(t, slot);
    await drawLabel(page, box, { x, y }, t, {
      bold,
      regular,
      includeName,
      publicUrl: opts.publicUrl,
    });
    slot += 1;
  }
  if (!page) doc.addPage([t.pageWidth * IN, t.pageHeight * IN]);
  return doc.save();
}

async function drawLabel(
  page: PDFPage,
  box: LabelSubject,
  origin: { x: number; y: number },
  t: LabelTemplateSpec,
  ctx: { bold: PDFFont; regular: PDFFont; includeName: boolean; publicUrl: string },
) {
  const pad = t.padding * IN;
  const w = t.labelWidth * IN;
  const h = t.labelHeight * IN;
  const qrSize = Math.min(t.qrSize * IN, h - 2 * pad);

  const png = await QRCode.toBuffer(qrPayload(ctx.publicUrl, box.labelId), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
  });
  const img = await page.doc.embedPng(png);

  if (t.layout === 'stack') {
    drawStacked(page, box, origin, t, ctx, img, { pad, w, h });
    return;
  }

  const qrX = origin.x + pad;
  const qrY = origin.y + (h - qrSize) / 2;
  page.drawImage(img, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  const textX = qrX + qrSize + pad * 0.8;
  const textMaxW = origin.x + w - pad - textX;

  // Label ID — shrink to fit if needed.
  let idSize = t.labelFontSize;
  while (idSize > 8 && ctx.bold.widthOfTextAtSize(box.labelId, idSize) > textMaxW) idSize -= 1;
  const nameLines = ctx.includeName && box.name ? 1 : 0;
  const nameSize = t.nameFontSize;
  const blockH = idSize + (nameLines ? nameSize * 1.5 : 0);
  const blockTop = origin.y + h / 2 + blockH / 2;
  page.drawText(box.labelId, {
    x: textX,
    y: blockTop - idSize * 0.85,
    size: idSize,
    font: ctx.bold,
    color: rgb(0.05, 0.05, 0.05),
  });
  if (nameLines) {
    const name = fitText(ctx.regular, box.name!, nameSize, textMaxW);
    page.drawText(name, {
      x: textX,
      y: blockTop - idSize - nameSize * 1.1,
      size: nameSize,
      font: ctx.regular,
      color: rgb(0.25, 0.25, 0.25),
    });
  }
}

/** Tall / single labels: big label ID on top, QR centred, optional name at the bottom. */
function drawStacked(
  page: PDFPage,
  box: LabelSubject,
  origin: { x: number; y: number },
  t: LabelTemplateSpec,
  ctx: { bold: PDFFont; regular: PDFFont; includeName: boolean; publicUrl: string },
  img: Awaited<ReturnType<PDFPage['doc']['embedPng']>>,
  d: { pad: number; w: number; h: number },
) {
  const { pad, w, h } = d;
  const maxW = w - 2 * pad;
  let idSize = t.labelFontSize;
  while (idSize > 10 && ctx.bold.widthOfTextAtSize(box.labelId, idSize) > maxW) idSize -= 1;
  const nameSize = t.nameFontSize;
  const hasName = Boolean(ctx.includeName && box.name);
  const gap = pad * 0.6;
  // Available height for the QR once text rows are reserved.
  const qrSize = Math.max(
    36,
    Math.min(
      t.qrSize * IN,
      h - 2 * pad - idSize - gap - (hasName ? nameSize * 1.4 + gap : 0),
      maxW,
    ),
  );
  const contentH = idSize + gap + qrSize + (hasName ? gap + nameSize * 1.4 : 0);
  let cursor = origin.y + h - (h - contentH) / 2; // top of the content block
  const centerX = origin.x + w / 2;

  const idW = ctx.bold.widthOfTextAtSize(box.labelId, idSize);
  page.drawText(box.labelId, {
    x: centerX - idW / 2,
    y: cursor - idSize * 0.8,
    size: idSize,
    font: ctx.bold,
    color: rgb(0.05, 0.05, 0.05),
  });
  cursor -= idSize + gap;
  page.drawImage(img, {
    x: centerX - qrSize / 2,
    y: cursor - qrSize,
    width: qrSize,
    height: qrSize,
  });
  cursor -= qrSize + gap;
  if (hasName) {
    const name = fitText(ctx.regular, box.name!, nameSize, maxW);
    const nameW = ctx.regular.widthOfTextAtSize(name, nameSize);
    page.drawText(name, {
      x: centerX - nameW / 2,
      y: cursor - nameSize,
      size: nameSize,
      font: ctx.regular,
      color: rgb(0.25, 0.25, 0.25),
    });
  }
}

/** Outlines every label cell so alignment can be checked against real stock. */
export async function renderCalibrationPdf(templateId?: string): Promise<Uint8Array> {
  const t = getTemplate(templateId);
  const doc = await PDFDocument.create();
  doc.setTitle(`ToteTrack calibration — ${t.name}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([t.pageWidth * IN, t.pageHeight * IN]);
  for (let i = 0; i < t.perSheet; i++) {
    const { x, y } = cellOrigin(t, i);
    page.drawRectangle({
      x,
      y,
      width: t.labelWidth * IN,
      height: t.labelHeight * IN,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.5,
    });
    page.drawText(`${i + 1}`, {
      x: x + 4,
      y: y + t.labelHeight * IN - 12,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    // centre cross-hair
    const cx = x + (t.labelWidth * IN) / 2;
    const cy = y + (t.labelHeight * IN) / 2;
    page.drawLine({
      start: { x: cx - 6, y: cy },
      end: { x: cx + 6, y: cy },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    page.drawLine({
      start: { x: cx, y: cy - 6 },
      end: { x: cx, y: cy + 6 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
  }
  page.drawText(
    `${t.name} — print at 100% scale (no "fit to page") and hold against a label sheet.`,
    {
      x: 0.5 * IN,
      y: 0.25 * IN,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    },
  );
  return doc.save();
}
