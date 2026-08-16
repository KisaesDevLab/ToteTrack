import { randomUUID } from 'node:crypto';
import {
  formatLabelId,
  type LabelLookup,
  type PreprintBatch,
  type PreprintedLabel,
} from '@totetrack/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/index.js';
import { boxes, preprintedLabels, series } from '../db/schema.js';
import type { PreprintedLabelRow } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getBoxSummaryByLabel } from './boxes.js';

function mapRow(r: PreprintedLabelRow & { seriesLetter: string }): PreprintedLabel {
  return {
    id: r.id,
    seriesId: r.seriesId,
    seriesLetter: r.seriesLetter,
    number: r.number,
    labelId: formatLabelId(r.seriesLetter, r.number),
    printedAt: r.printedAt.toISOString(),
    claimedBoxId: r.claimedBoxId,
    claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
    batchId: r.batchId,
  };
}

/**
 * Reserves the next `count` numbers of a series (advancing `next_number` past them) and records them
 * as pre-printed, so future auto-numbered boxes never collide with a label already on a tote.
 */
export async function reservePreprinted(
  db: Db,
  seriesId: number,
  count: number,
  templateId?: string,
): Promise<PreprintedLabel[]> {
  const batchId = randomUUID();
  return db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(series)
      .where(eq(series.id, seriesId))
      .for('update')
      .limit(1);
    if (!s) throw badRequest('Series not found');
    const first = s.nextNumber;
    const numbers = Array.from({ length: count }, (_, i) => first + i);
    const rows = await tx
      .insert(preprintedLabels)
      .values(
        numbers.map((number) => ({ seriesId, number, batchId, templateId: templateId ?? null })),
      )
      .returning();
    await tx
      .update(series)
      .set({ nextNumber: first + count })
      .where(eq(series.id, seriesId));
    return rows.map((r) => mapRow({ ...r, seriesLetter: s.letter }));
  });
}

/**
 * Marks a pre-printed label as used by a box (no-op if the number wasn't pre-printed). A claimed
 * label is already stuck on the tote, so the box is also flagged as printed.
 */
export async function claimPreprinted(
  tx: Db | Tx,
  seriesId: number,
  number: number,
  boxId: number,
): Promise<boolean> {
  const claimed = await tx
    .update(preprintedLabels)
    .set({ claimedBoxId: boxId, claimedAt: sql`now()` as unknown as Date })
    .where(
      and(
        eq(preprintedLabels.seriesId, seriesId),
        eq(preprintedLabels.number, number),
        isNull(preprintedLabels.claimedAt),
      ),
    )
    .returning({ id: preprintedLabels.id });
  if (!claimed.length) return false;
  await tx
    .update(boxes)
    .set({ printedAt: sql`now()` as unknown as Date })
    .where(eq(boxes.id, boxId));
  return true;
}

export async function listPreprinted(
  db: Db,
  opts: { seriesId?: number; unclaimedOnly?: boolean } = {},
): Promise<PreprintedLabel[]> {
  const where = [
    opts.seriesId ? eq(preprintedLabels.seriesId, opts.seriesId) : undefined,
    opts.unclaimedOnly ? isNull(preprintedLabels.claimedAt) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  const rows = await db
    .select({ row: preprintedLabels, seriesLetter: series.letter })
    .from(preprintedLabels)
    .innerJoin(series, eq(series.id, preprintedLabels.seriesId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(series.letter), asc(preprintedLabels.number));
  return rows.map((r) => mapRow({ ...r.row, seriesLetter: r.seriesLetter }));
}

/** Batches (labels printed together), newest first. Voided labels simply drop out of their batch. */
export async function listPreprintBatches(db: Db, seriesId?: number): Promise<PreprintBatch[]> {
  const rows = await db
    .select({
      batchId: preprintedLabels.batchId,
      seriesId: preprintedLabels.seriesId,
      seriesLetter: series.letter,
      first: sql<number>`min(${preprintedLabels.number})`,
      last: sql<number>`max(${preprintedLabels.number})`,
      count: sql<number>`count(*)::int`,
      unclaimed: sql<number>`count(*) FILTER (WHERE ${preprintedLabels.claimedAt} IS NULL)::int`,
      printedAt: sql<Date>`min(${preprintedLabels.printedAt})`,
      templateId: sql<string | null>`min(${preprintedLabels.templateId})`,
    })
    .from(preprintedLabels)
    .innerJoin(series, eq(series.id, preprintedLabels.seriesId))
    .where(
      and(
        sql`${preprintedLabels.batchId} IS NOT NULL`,
        seriesId ? eq(preprintedLabels.seriesId, seriesId) : undefined,
      ),
    )
    .groupBy(preprintedLabels.batchId, preprintedLabels.seriesId, series.letter)
    .orderBy(desc(sql`min(${preprintedLabels.printedAt})`));
  return rows.map((r) => ({
    batchId: r.batchId!,
    seriesId: r.seriesId,
    seriesLetter: r.seriesLetter,
    firstLabelId: formatLabelId(r.seriesLetter, Number(r.first)),
    lastLabelId: formatLabelId(r.seriesLetter, Number(r.last)),
    count: Number(r.count),
    unclaimed: Number(r.unclaimed),
    printedAt: new Date(r.printedAt).toISOString(),
    templateId: r.templateId,
  }));
}

/** Labels of one batch, in number order (optionally only the ones no box has claimed yet). */
export async function listBatchLabels(
  db: Db,
  batchId: string,
  opts: { unclaimedOnly?: boolean } = {},
): Promise<PreprintedLabel[]> {
  const rows = await db
    .select({ row: preprintedLabels, seriesLetter: series.letter })
    .from(preprintedLabels)
    .innerJoin(series, eq(series.id, preprintedLabels.seriesId))
    .where(
      and(
        eq(preprintedLabels.batchId, batchId),
        opts.unclaimedOnly ? isNull(preprintedLabels.claimedAt) : undefined,
      ),
    )
    .orderBy(asc(preprintedLabels.number));
  return rows.map((r) => mapRow({ ...r.row, seriesLetter: r.seriesLetter }));
}

/** Voids a pre-printed label that was never stuck on a tote (e.g. misprint). */
export async function deletePreprinted(db: Db, id: number): Promise<void> {
  const deleted = await db
    .delete(preprintedLabels)
    .where(and(eq(preprintedLabels.id, id), isNull(preprintedLabels.claimedAt)))
    .returning({ id: preprintedLabels.id });
  if (!deleted.length) throw notFound('Pre-printed label not found (or already claimed)');
}

/** Resolves a scanned label: existing box, box in the Trash, pre-printed-but-unclaimed label, or unknown. */
export async function lookupLabel(db: Db, normalized: string): Promise<LabelLookup> {
  const found = await getBoxSummaryByLabel(db, normalized);
  const box = found && !found.deletedAt ? found : null;
  const trashedBox = found?.deletedAt ? found : null;
  const letter = normalized[0]!;
  const number = Number.parseInt(normalized.slice(2), 10);
  const [s] = await db.select().from(series).where(eq(series.letter, letter)).limit(1);
  let preprinted: PreprintedLabel | null = null;
  if (s) {
    const [row] = await db
      .select()
      .from(preprintedLabels)
      .where(and(eq(preprintedLabels.seriesId, s.id), eq(preprintedLabels.number, number)))
      .limit(1);
    if (row) preprinted = mapRow({ ...row, seriesLetter: s.letter });
  }
  return { labelId: normalized, box, trashedBox, preprinted, seriesId: s?.id ?? null };
}
