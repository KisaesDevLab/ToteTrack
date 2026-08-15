import { SeriesCreateInput, SeriesUpdateInput } from '@totetrack/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/index.js';
import { boxes, series } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { asyncHandler, idParam, parseBody } from '../lib/http.js';
import { isUniqueViolation } from '../services/boxes.js';

const boxCountSql = sql<number>`(SELECT count(*)::int FROM boxes b WHERE b.series_id = ${series.id})`;

function mapSeries(r: {
  id: number;
  letter: string;
  description: string | null;
  nextNumber: number;
  createdAt: Date;
  boxCount?: number;
}) {
  return {
    id: r.id,
    letter: r.letter,
    description: r.description,
    nextNumber: r.nextNumber,
    boxCount: r.boxCount !== undefined ? Number(r.boxCount) : undefined,
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
        const maxUsed = mx?.max ?? 0;
        if (input.nextNumber <= Number(maxUsed))
          throw badRequest(`Next number must be greater than the highest used number (${maxUsed})`);
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
      const deleted = await db.delete(series).where(eq(series.id, id)).returning({ id: series.id });
      if (!deleted.length) throw notFound('Series not found');
      res.status(204).end();
    }),
  );

  return r;
}
