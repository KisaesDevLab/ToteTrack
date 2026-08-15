import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Photo } from '@totetrack/shared';
import type { Db } from '../db/index.js';
import { boxes, items, photos } from '../db/schema.js';
import { notFound, unsupportedMedia } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { mapPhoto, requireBox } from './boxes.js';
import { refreshBoxSearchVector } from './search-vector.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const THUMB_SIZE = 400;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
  'image/tiff',
]);

export interface PhotoStorage {
  root: string;
  /** Absolute path for a stored relative path; refuses traversal outside root. */
  resolve(rel: string): string;
}

export function createPhotoStorage(root: string): PhotoStorage {
  const abs = path.resolve(root);
  return {
    root: abs,
    resolve(rel) {
      const p = path.resolve(abs, rel);
      if (!p.startsWith(abs + path.sep) && p !== abs) throw new Error('Path outside photo root');
      return p;
    },
  };
}

export async function ensurePhotoDir(storage: PhotoStorage): Promise<void> {
  await fs.mkdir(storage.root, { recursive: true });
}

/**
 * Validates the upload (real mime sniffing, not the client-provided type),
 * stores the original + a 400px WebP thumbnail under `<root>/<boxId>/`, and records the row.
 */
export async function storePhoto(
  db: Db,
  storage: PhotoStorage,
  boxId: number,
  buffer: Buffer,
): Promise<Photo> {
  await requireBox(db, boxId);
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw unsupportedMedia(
      'Only image uploads are supported (JPEG, PNG, WebP, HEIC, GIF, AVIF, TIFF)',
    );
  }

  const image = sharp(buffer, { failOn: 'none' }).rotate(); // apply EXIF orientation
  const meta = await image.metadata();

  const dir = String(boxId);
  const base = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  // Normalise originals to JPEG for consistent browser support (HEIC etc.), keeping full resolution.
  const originalRel = path.posix.join(dir, `${base}.jpg`);
  const thumbRel = path.posix.join(dir, `${base}.thumb.webp`);
  await fs.mkdir(storage.resolve(dir), { recursive: true });

  const originalBuf =
    detected.mime === 'image/jpeg'
      ? await sharp(buffer).rotate().jpeg({ quality: 92 }).toBuffer()
      : await image.clone().jpeg({ quality: 90 }).toBuffer();
  const thumbBuf = await sharp(originalBuf)
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const originalMeta = await sharp(originalBuf).metadata();

  await fs.writeFile(storage.resolve(originalRel), originalBuf);
  await fs.writeFile(storage.resolve(thumbRel), thumbBuf);

  const [mx] = await db
    .select({ max: sql<number | null>`max(${photos.sortOrder})` })
    .from(photos)
    .where(eq(photos.boxId, boxId));
  const sortOrder = Number(mx?.max ?? -1) + 1;

  const [row] = await db
    .insert(photos)
    .values({
      boxId,
      sortOrder,
      originalPath: originalRel,
      thumbPath: thumbRel,
      width: originalMeta.width ?? meta.width ?? null,
      height: originalMeta.height ?? meta.height ?? null,
    })
    .returning();
  return mapPhoto(row!);
}

export async function getPhotoRow(db: Db, id: number) {
  const [row] = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  if (!row) throw notFound('Photo not found');
  return row;
}

export async function listPhotos(db: Db, boxId: number): Promise<Photo[]> {
  const rows = await db
    .select()
    .from(photos)
    .where(eq(photos.boxId, boxId))
    .orderBy(asc(photos.sortOrder), asc(photos.id));
  return rows.map(mapPhoto);
}

export async function reorderPhotos(db: Db, boxId: number, ids: number[]): Promise<Photo[]> {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx
        .update(photos)
        .set({ sortOrder: i })
        .where(sql`${photos.id} = ${id} AND ${photos.boxId} = ${boxId}`);
    }
  });
  return listPhotos(db, boxId);
}

/**
 * Deletes a photo and the AI-sourced items that were derived from it (their evidence is gone);
 * manual items are never touched. The box description is rebuilt from the remaining photos.
 */
export async function deletePhoto(db: Db, storage: PhotoStorage, id: number): Promise<number> {
  const row = await getPhotoRow(db, id);
  await db.transaction(async (tx) => {
    await tx.delete(items).where(and(eq(items.photoId, id), eq(items.source, 'ai')));
    await tx.delete(photos).where(eq(photos.id, id));
    const remaining = await tx
      .select({ d: photos.aiDescription })
      .from(photos)
      .where(eq(photos.boxId, row.boxId))
      .orderBy(asc(photos.sortOrder), asc(photos.id));
    const summaries = remaining.map((r) => r.d?.trim()).filter((d): d is string => Boolean(d));
    const [box] = await tx
      .select({ d: boxes.aiDescription })
      .from(boxes)
      .where(eq(boxes.id, row.boxId))
      .limit(1);
    // Rebuild only when the box description was derived from photos (i.e. contains this photo's summary);
    // a box-level analysis result is left alone.
    if (row.aiDescription && box?.d && box.d.includes(row.aiDescription.trim())) {
      await tx
        .update(boxes)
        .set({ aiDescription: summaries.length ? summaries.join('\n\n') : null })
        .where(eq(boxes.id, row.boxId));
    }
    await refreshBoxSearchVector(tx, row.boxId);
  });
  await removeFiles(storage, [row.originalPath, row.thumbPath]);
  return row.boxId;
}

export async function removeFiles(storage: PhotoStorage, rels: string[]): Promise<void> {
  for (const rel of rels) {
    try {
      await fs.unlink(storage.resolve(rel));
    } catch (err) {
      logger.warn({ err, rel }, 'failed to remove photo file');
    }
  }
}

/** Reads a stored original and returns a JPEG buffer resized for the vision API (≤1568px longest edge). */
export async function readForVision(storage: PhotoStorage, rel: string): Promise<Buffer> {
  return sharp(storage.resolve(rel))
    .rotate()
    .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}
