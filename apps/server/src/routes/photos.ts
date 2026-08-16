import { Router, type Response } from 'express';
import type { Db } from '../db/index.js';
import { serviceUnavailable } from '../lib/errors.js';
import { asyncHandler, idParam } from '../lib/http.js';
import type { AiService } from '../services/ai.js';
import { deletePhoto, getPhotoRow, type PhotoStorage } from '../services/photos.js';

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

  r.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await deletePhoto(db, storage, idParam(req.params.id));
      res.status(204).end();
    }),
  );

  r.post(
    '/:id/analyze',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      await getPhotoRow(db, id);
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
    res.sendFile(absPath, (err) => (err ? reject(err) : resolve()));
  });
}
