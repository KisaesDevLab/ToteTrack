import { SeriesCreateInput, SeriesUpdateInput } from '@totetrack/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/index.js';
import { boxes, preprintedLabels, series } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { asyncHandler, idParam, parseBody } from '../lib/http.js';
import { isUniqueViolation } from '../services/boxes.js';

// NB: reference the outer table explicitly — in a join-less select Drizzle renders `${series.id}` as a bare
// "id", which a correlated subquery would resolve to the inner table's column.
const boxCountSql = sql<number>`(SELECT count(*)::int FROM boxes b WHERE b.series_id = series.id AND b.deleted_at IS NULL)`;
const unclaimedSql = sql<number>`(SELECT count(*)::int FROM preprinted_labels p WHERE p.series_id = series.id AND p.claimed_at IS NULL)`;

function mapSeries(r: {
  id: number;
  letter: string;
  description: string | null;
  nextNumber: number;
  createdAt: Date;
  boxCount?: number;
  unclaimedLabels?: number;
}) {
  return {
    id: r.id,
    letter: r.letter,
    description: r.description,
    nextNumber: r.nextNumber,
    boxCount: r.boxCount !== undefined ? Number(r.boxCount) : undefined,
    unclaimedLabels: r.unclaimedLabels !== undefined ? Number(r.unclaimedLabels) : undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

export function seriesRouter(db: Db): Router {
  const r = Router();

  r.get(
    '/',
    asyncHandler(async (_req, res) => {
      const rows = await db
        .select({
          id: series.id,
          letter: series.letter,
          description: series.description,
          nextNumber: series.nextNumber,
          createdAt: series.createdAt,
          boxCount: boxCountSql,
          unclaimedLabels: unclaimedSql,
        })
        .from(series)
        .orderBy(asc(series.letter));
      res.json(rows.map(mapSeries));
    }),
  );

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseBody(SeriesCreateInput, req.body);
      try {
        const [row] = await db
          .insert(series)
          .values({ letter: input.letter, description: input.description?.trim() || null })
          .returning();
        res.status(201).json(mapSeries({ ...row!, boxCount: 0 }));
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`Series ${input.letter} already exists`);
        throw err;
      }
    }),
  );

  r.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      const input = parseBody(SeriesUpdateInput, req.body);
      const [existing] = await db.select().from(series).where(eq(series.id, id)).limit(1);
      if (!existing) throw notFound('Series not found');
      if (input.nextNumber !== undefined) {
        const [mx] = await db
          .select({ max: sql<number | null>`max(${boxes.number})` })
          .from(boxes)
          .where(eq(boxes.seriesId, id));
        const [pm] = await db
          .select({ max: sql<number | null>`max(${preprintedLabels.number})` })
          .from(preprintedLabels)
          .where(eq(preprintedLabels.seriesId, id));
        const maxUsed = Math.max(Number(mx?.max ?? 0), Number(pm?.max ?? 0));
        if (input.nextNumber <= maxUsed)
          throw badRequest(
            `Next number must be greater than the highest used or pre-printed number (${maxUsed})`,
          );
      }
      const [row] = await db
        .update(series)
        .set({
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.nextNumber !== undefined ? { nextNumber: input.nextNumber } : {}),
        })
        .where(eq(series.id, id))
        .returning();
      res.json(mapSeries(row!));
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      const [cnt] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(boxes)
        .where(eq(boxes.seriesId, id));
      if (Number(cnt?.n ?? 0) > 0) throw conflict('Cannot delete a series that still has boxes');
      const [pre] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(preprintedLabels)
        .where(and(eq(preprintedLabels.seriesId, id), isNull(preprintedLabels.claimedAt)));
      if (Number(pre?.n ?? 0) > 0)
        throw conflict(
          'Cannot delete a series that still has pre-printed labels waiting — void them first',
        );
      const deleted = await db.delete(series).where(eq(series.id, id)).returning({ id: series.id });
      if (!deleted.length) throw notFound('Series not found');
      res.status(204).end();
    }),
  );

  return r;
}
