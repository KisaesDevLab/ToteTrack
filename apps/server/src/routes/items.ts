import { ItemUpdateInput } from '@totetrack/shared';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/index.js';
import { items } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { asyncHandler, idParam, parseBody } from '../lib/http.js';
import { mapItem } from '../services/boxes.js';
import { refreshBoxSearchVector } from '../services/search-vector.js';

export function itemsRouter(db: Db): Router {
  const r = Router();

  r.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      const input = parseBody(ItemUpdateInput, req.body);
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(items)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.qty !== undefined ? { qty: input.qty } : {}),
            ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
            updatedAt: sql`now()` as unknown as Date,
          })
          .where(eq(items.id, id))
          .returning();
        if (!updated) throw notFound('Item not found');
        await refreshBoxSearchVector(tx, updated.boxId);
        return updated;
      });
      res.json(mapItem(row));
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      await db.transaction(async (tx) => {
        const [deleted] = await tx.delete(items).where(eq(items.id, id)).returning();
        if (!deleted) throw notFound('Item not found');
        await refreshBoxSearchVector(tx, deleted.boxId);
      });
      res.status(204).end();
    }),
  );

  return r;
}
