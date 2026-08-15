import {
  BoxCreateInput,
  BoxListQuery,
  BoxUpdateInput,
  ItemCreateInput,
  normalizeLabelId,
  PhotoReorderInput,
} from '@totetrack/shared';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import type { Db } from '../db/index.js';
import { items } from '../db/schema.js';
import { badRequest, notFound, serviceUnavailable } from '../lib/errors.js';
import { asyncHandler, idParam, parseBody, parseQuery } from '../lib/http.js';
import type { AiService } from '../services/ai.js';
import {
  createBox,
  deleteBox,
  getBoxDetail,
  getBoxSummaryByLabel,
  listBoxes,
  mapItem,
  requireBox,
  toggleBoxStatus,
  updateBox,
} from '../services/boxes.js';
import {
  MAX_UPLOAD_BYTES,
  removeFiles,
  reorderPhotos,
  storePhoto,
  type PhotoStorage,
} from '../services/photos.js';
import { refreshBoxSearchVector } from '../services/search-vector.js';

export interface BoxesDeps {
  db: Db;
  storage: PhotoStorage;
  ai: AiService;
}

export function boxesRouter({ db, storage, ai }: BoxesDeps): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 20 },
  });

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const q = parseQuery(BoxListQuery, req.query);
      res.json(await listBoxes(db, q));
    }),
  );

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseBody(BoxCreateInput, req.body);
      res.status(201).json(await createBox(db, input));
    }),
  );

  // Case-insensitive label lookup used by QR deep links (/b/:labelId).
  r.get(
    '/by-label/:labelId',
    asyncHandler(async (req, res) => {
      const normalized = normalizeLabelId(String(req.params.labelId ?? ''));
      if (!normalized) throw badRequest('Invalid label');
      const box = await getBoxSummaryByLabel(db, normalized);
      if (!box) throw notFound(`No box with label ${normalized}`);
      res.json(box);
    }),
  );

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const detail = await getBoxDetail(db, idParam(req.params.id));
      if (!detail) throw notFound('Box not found');
      res.json(detail);
    }),
  );

  r.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const input = parseBody(BoxUpdateInput, req.body);
      res.json(await updateBox(db, idParam(req.params.id), input));
    }),
  );

  r.post(
    '/:id/toggle-status',
    asyncHandler(async (req, res) => {
      res.json(await toggleBoxStatus(db, idParam(req.params.id)));
    }),
  );

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const { photoPaths } = await deleteBox(db, idParam(req.params.id));
      await removeFiles(storage, photoPaths);
      res.status(204).end();
    }),
  );

  // --- photos ------------------------------------------------------------

  r.post(
    '/:id/photos',
    upload.array('photos', 20),
    asyncHandler(async (req, res) => {
      const boxId = idParam(req.params.id);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) throw badRequest('No photos uploaded (field name: photos)');
      const created = [];
      for (const f of files) {
        const photo = await storePhoto(db, storage, boxId, f.buffer);
        created.push(photo);
      }
      // Kick off AI after all files are stored so the queue order matches upload order.
      let queued = false;
      for (const p of created) {
        if (await ai.maybeAutoAnalyzePhoto(p.id)) queued = true;
      }
      const detail = (await getBoxDetail(db, boxId))!;
      const createdIds = new Set(created.map((p) => p.id));
      const photosOut = detail.photos.filter((p) => createdIds.has(p.id));
      res.status(201).json({ photos: photosOut, aiQueued: queued, box: detail });
    }),
  );

  r.put(
    '/:id/photos/reorder',
    asyncHandler(async (req, res) => {
      const boxId = idParam(req.params.id);
      const { ids } = parseBody(PhotoReorderInput, req.body);
      await requireBox(db, boxId);
      res.json(await reorderPhotos(db, boxId, ids));
    }),
  );

  // --- AI ----------------------------------------------------------------

  r.post(
    '/:id/analyze',
    asyncHandler(async (req, res) => {
      const boxId = idParam(req.params.id);
      await requireBox(db, boxId);
      if (!ai.available)
        throw serviceUnavailable('AI analysis is not configured (ANTHROPIC_API_KEY unset)');
      await ai.enqueueBox(boxId);
      res.status(202).json({ queued: true });
    }),
  );

  // --- items -------------------------------------------------------------

  r.get(
    '/:id/items',
    asyncHandler(async (req, res) => {
      const boxId = idParam(req.params.id);
      await requireBox(db, boxId);
      const rows = await db.select().from(items).where(eq(items.boxId, boxId)).orderBy(items.id);
      res.json(rows.map(mapItem));
    }),
  );

  r.post(
    '/:id/items',
    asyncHandler(async (req, res) => {
      const boxId = idParam(req.params.id);
      const input = parseBody(ItemCreateInput, req.body);
      const row = await db.transaction(async (tx) => {
        await requireBox(tx, boxId);
        const [created] = await tx
          .insert(items)
          .values({
            boxId,
            name: input.name,
            qty: input.qty ?? 1,
            note: input.note?.trim() || null,
            source: 'manual',
          })
          .returning();
        await refreshBoxSearchVector(tx, boxId);
        return created!;
      });
      res.status(201).json(mapItem(row));
    }),
  );

  // Bulk delete: ?source=ai removes AI-sourced rows; no source removes all items.
  r.delete(
    '/:id/items',
    asyncHandler(async (req, res) => {
      const boxId = idParam(req.params.id);
      const source =
        req.query.source === 'ai' ? 'ai' : req.query.source === 'manual' ? 'manual' : undefined;
      const deleted = await db.transaction(async (tx) => {
        await requireBox(tx, boxId);
        const where = source
          ? and(eq(items.boxId, boxId), eq(items.source, source))
          : eq(items.boxId, boxId);
        const rows = await tx.delete(items).where(where).returning({ id: items.id });
        await refreshBoxSearchVector(tx, boxId);
        return rows.length;
      });
      res.json({ deleted });
    }),
  );

  return r;
}
