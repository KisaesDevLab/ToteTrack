import { formatLabelId, type LabelLookup, type PreprintedLabel } from '@totetrack/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
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
): Promise<PreprintedLabel[]> {
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
      .values(numbers.map((number) => ({ seriesId, number })))
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

/** Voids a pre-printed label that was never stuck on a tote (e.g. misprint). */
export async function deletePreprinted(db: Db, id: number): Promise<void> {
  const deleted = await db
    .delete(preprintedLabels)
    .where(and(eq(preprintedLabels.id, id), isNull(preprintedLabels.claimedAt)))
    .returning({ id: preprintedLabels.id });
  if (!deleted.length) throw notFound('Pre-printed label not found (or already claimed)');
}

/** Resolves a scanned label: existing box, pre-printed-but-unclaimed label, or unknown. */
export async function lookupLabel(db: Db, normalized: string): Promise<LabelLookup> {
  const box = await getBoxSummaryByLabel(db, normalized);
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
  return { labelId: normalized, box, preprinted, seriesId: s?.id ?? null };
}
