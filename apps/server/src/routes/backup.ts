import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { PinStore } from '../auth/pin.js';
import type { Db } from '../db/index.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import type { AiService } from '../services/ai.js';
import { restoreBackup, writeBackup } from '../services/backup.js';
import type { PhotoStorage } from '../services/photos.js';

const MAX_BACKUP_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

/** Full backup (zip of all tables + photo files) and PIN-confirmed restore. */
export function backupRouter(
  db: Db,
  storage: PhotoStorage,
  pins: PinStore,
  ai: AiService,
  version: string,
): Router {
  const r = Router();
  // The archive can be GBs — stage it on disk, never in memory.
  const upload = multer({
    storage: multer.diskStorage({ destination: os.tmpdir() }),
    limits: { fileSize: MAX_BACKUP_BYTES, files: 1 },
  });

  r.get(
    '/',
    asyncHandler(async (_req, res) => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      res.type('application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="totetrack-backup-${stamp}.zip"`);
      await writeBackup(db, storage, res, version);
    }),
  );

  // multipart: backup=<zip>, pin=<current PIN>. Replaces ALL data (settings secrets and the PIN stay).
  r.post(
    '/restore',
    upload.single('backup'),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) throw badRequest('No backup file uploaded (field name: backup)');
      try {
        const pin = String(req.body?.pin ?? '');
        if (!(await pins.verify(pin))) throw unauthorized('Incorrect PIN');
        // Anything queued against the old data would target rows that no longer exist.
        await ai.idle();
        const result = await restoreBackup(db, storage, file.path);
        await ai.recoverPending();
        res.json(result);
      } finally {
        await fs
          .rm(file.path, { force: true })
          .catch((err) =>
            logger.warn(
              { err, path: path.basename(file.path) },
              'could not remove uploaded backup',
            ),
          );
      }
    }),
  );

  return r;
}
