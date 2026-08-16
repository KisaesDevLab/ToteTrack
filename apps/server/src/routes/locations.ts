import { LocationCreateInput, LocationReorderInput, LocationUpdateInput } from '@totetrack/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/index.js';
import { boxes, locations } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { asyncHandler, idParam, parseBody } from '../lib/http.js';
import { isUniqueViolation } from '../services/boxes.js';
import {
  refreshBoxSearchVector,
  refreshSearchVectorsForLocation,
} from '../services/search-vector.js';

// Explicit outer-table reference (see series.ts): `${locations.id}` would render unqualified here.
const boxCountSql = sql<number>`(SELECT count(*)::int FROM boxes b WHERE b.location_id = locations.id AND b.deleted_at IS NULL)`;

function mapLocation(r: {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: Date;
  boxCount?: number;
}) {
  return {
    id: r.id,
    name: r.name,
    sortOrder: r.sortOrder,
    boxCount: r.boxCount !== undefined ? Number(r.boxCount) : undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

export function locationsRouter(db: Db): Router {
  const r = Router();

  r.get(
    '/',
    asyncHandler(async (_req, res) => {
      const rows = await db
        .select({
          id: locations.id,
          name: locations.name,
          sortOrder: locations.sortOrder,
          createdAt: locations.createdAt,
          boxCount: boxCountSql,
        })
        .from(locations)
        .orderBy(asc(locations.sortOrder), asc(locations.name));
      res.json(rows.map(mapLocation));
    }),
  );

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseBody(LocationCreateInput, req.body);
      try {
        const [mx] = await db
          .select({ max: sql<number | null>`max(${locations.sortOrder})` })
          .from(locations);
        const sortOrder = input.sortOrder ?? Number(mx?.max ?? -1) + 1;
        const [row] = await db
          .insert(locations)
          .values({ name: input.name, sortOrder })
          .returning();
        res.status(201).json(mapLocation({ ...row!, boxCount: 0 }));
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`Location "${input.name}" already exists`);
        throw err;
      }
    }),
  );

  r.put(
    '/reorder',
    asyncHandler(async (req, res) => {
      const { ids } = parseBody(LocationReorderInput, req.body);
      await db.transaction(async (tx) => {
        for (const [i, id] of ids.entries()) {
          await tx.update(locations).set({ sortOrder: i }).where(eq(locations.id, id));
        }
      });
      res.json({ ok: true });
    }),
  );

  r.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      const input = parseBody(LocationUpdateInput, req.body);
      try {
        const row = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(locations)
            .set({
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            })
            .where(eq(locations.id, id))
            .returning();
          if (!updated) throw notFound('Location not found');
          if (input.name !== undefined) await refreshSearchVectorsForLocation(tx, id);
          return updated;
        });
        res.json(mapLocation(row));
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`Location "${input.name}" already exists`);
        throw err;
      }
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      await db.transaction(async (tx) => {
        const affected = await tx
          .select({ id: boxes.id })
          .from(boxes)
          .where(eq(boxes.locationId, id));
        const deleted = await tx
          .delete(locations)
          .where(eq(locations.id, id))
          .returning({ id: locations.id });
        if (!deleted.length) throw notFound('Location not found');
        // FK is ON DELETE SET NULL; refresh vectors for the boxes that lost their location.
        for (const b of affected) await refreshBoxSearchVector(tx, b.id);
      });
      res.status(204).end();
    }),
  );

  return r;
}
