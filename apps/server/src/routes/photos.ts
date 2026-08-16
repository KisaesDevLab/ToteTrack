import { Router, type Response } from 'express';
import type { Db } from '../db/index.js';
import { notFound, serviceUnavailable } from '../lib/errors.js';
import { asyncHandler, idParam } from '../lib/http.js';
import type { AiService } from '../services/ai.js';
import {
  getPhotoRow,
  purgePhoto,
  removeFiles,
  restorePhoto,
  trashPhoto,
  type PhotoStorage,
} from '../services/photos.js';

export function photosRouter(db: Db, storage: PhotoStorage, ai: AiService): Router {
  const r = Router();

  // Session-protected file serving (this router is mounted behind requireAuth).
  r.get(
    '/:id/thumb',
    asyncHandler(async (req, res) => {
      const p = await getPhotoRow(db, idParam(req.params.id));
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.type('image/webp');
      await sendFile(res, storage.resolve(p.thumbPath));
    }),
  );

  r.get(
    '/:id/original',
    asyncHandler(async (req, res) => {
      const p = await getPhotoRow(db, idParam(req.params.id));
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.type('image/jpeg');
      await sendFile(res, storage.resolve(p.originalPath));
    }),
  );

  // Default: move to the Trash (restorable for 30 days). ?permanent=true deletes for good.
  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      if (req.query.permanent === 'true') {
        const { photoPaths } = await purgePhoto(db, id);
        await removeFiles(storage, photoPaths);
      } else {
        await trashPhoto(db, id);
      }
      res.status(204).end();
    }),
  );

  r.post(
    '/:id/restore',
    asyncHandler(async (req, res) => {
      res.json(await restorePhoto(db, idParam(req.params.id)));
    }),
  );

  r.post(
    '/:id/analyze',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      const p = await getPhotoRow(db, id);
      if (p.deletedAt) throw notFound('Photo is in the Trash');
      if (!(await ai.isAvailable()))
        throw serviceUnavailable(
          'AI analysis is not configured — add an Anthropic API key in Settings or ANTHROPIC_API_KEY',
        );
      await ai.enqueuePhoto(id);
      res.status(202).json({ queued: true });
    }),
  );

  return r;
}

function sendFile(res: Response, absPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    res.sendFile(absPath, (err) => {
      if (!err) return resolve();
      const e = err as NodeJS.ErrnoException & { status?: number };
      if (e.code === 'ENOENT' || e.status === 404) return reject(notFound('Photo file is missing'));
      reject(err);
    });
  });
}
