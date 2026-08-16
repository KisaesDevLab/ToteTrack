import { Router } from 'express';
import type { Db } from '../db/index.js';
import { asyncHandler } from '../lib/http.js';
import type { PhotoStorage } from '../services/photos.js';
import { listTrash, purgeTrash } from '../services/trash.js';

/** Trash: soft-deleted boxes and photos, restorable for TRASH_RETENTION_DAYS. */
export function trashRouter(db: Db, storage: PhotoStorage): Router {
  const r = Router();

  r.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await listTrash(db));
    }),
  );

  // Empty the Trash now (everything, regardless of age).
  r.delete(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await purgeTrash(db, storage, { all: true }));
    }),
  );

  return r;
}
