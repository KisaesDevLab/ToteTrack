import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Photo } from '@totetrack/shared';
import type { Db } from '../db/index.js';
import { boxes, items, photos } from '../db/schema.js';
import { conflict, notFound, unsupportedMedia } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { mapPhoto, requireBox } from './boxes.js';
import { refreshBoxSearchVector } from './search-vector.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const THUMB_SIZE = 400;
// NB: HEIC/HEIF (HEVC) is deliberately absent — sharp's prebuilt libvips cannot decode it. iOS transcodes
// camera-roll HEICs to JPEG for <input type=file>, so phones are unaffected.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
]);
const UNSUPPORTED_MSG = 'Only JPEG, PNG, WebP, GIF, AVIF or TIFF images are supported';

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
/** A validated, decoded upload ready to be written. */
export interface PreparedPhoto {
  original: Buffer;
  thumb: Buffer;
  width: number | null;
  height: number | null;
}

/**
 * Sniffs the real type and fully decodes/re-encodes the image (JPEG original at full resolution +
 * 400px WebP thumb). Throws 415 for anything that isn't a decodable supported image — call this for
 * every file BEFORE doing anything destructive (e.g. rescan replacing old photos).
 */
export async function preparePhoto(buffer: Buffer): Promise<PreparedPhoto> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) throw unsupportedMedia(UNSUPPORTED_MSG);
  try {
    const original = await sharp(buffer, { failOn: 'none' })
      .rotate() // apply EXIF orientation
      .jpeg({ quality: detected.mime === 'image/jpeg' ? 92 : 90 })
      .toBuffer();
    const thumb = await sharp(original)
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const meta = await sharp(original).metadata();
    return { original, thumb, width: meta.width ?? null, height: meta.height ?? null };
  } catch (err) {
    logger.warn({ err, mime: detected.mime }, 'image decode failed');
    throw unsupportedMedia(`${UNSUPPORTED_MSG} (this file could not be decoded)`);
  }
}

export async function preparePhotos(buffers: Buffer[]): Promise<PreparedPhoto[]> {
  const out: PreparedPhoto[] = [];
  for (const b of buffers) out.push(await preparePhoto(b));
  return out;
}

/** Writes a prepared photo under `<root>/<boxId>/` and records the row (files removed on DB failure). */
export async function storePhoto(
  db: Db,
  storage: PhotoStorage,
  boxId: number,
  prepared: PreparedPhoto,
): Promise<Photo> {
  await requireBox(db, boxId);
  const dir = String(boxId);
  const base = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const originalRel = path.posix.join(dir, `${base}.jpg`);
  const thumbRel = path.posix.join(dir, `${base}.thumb.webp`);
  await fs.mkdir(storage.resolve(dir), { recursive: true });
  await fs.writeFile(storage.resolve(originalRel), prepared.original);
  await fs.writeFile(storage.resolve(thumbRel), prepared.thumb);
  try {
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
        width: prepared.width,
        height: prepared.height,
      })
      .returning();
    return mapPhoto(row!);
  } catch (err) {
    await removeFiles(storage, [originalRel, thumbRel]);
    throw err;
  }
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
    .where(and(eq(photos.boxId, boxId), isNull(photos.deletedAt)))
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
 * Moves a photo to the Trash (soft delete; files kept until purge). The AI-sourced items derived
 * from it are removed for good (their evidence is gone — restoring the photo lets you re-run AI);
 * manual items are never touched. The box description is rebuilt from the remaining photos.
 */
export async function trashPhoto(db: Db, id: number): Promise<number> {
  const row = await getPhotoRow(db, id);
  if (row.deletedAt) return row.boxId;
  await db.transaction(async (tx) => {
    await tx.delete(items).where(and(eq(items.photoId, id), eq(items.source, 'ai')));
    await tx
      .update(photos)
      .set({ deletedAt: sql`now()` as unknown as Date })
      .where(eq(photos.id, id));
    const remaining = await tx
      .select({ d: photos.aiDescription })
      .from(photos)
      .where(and(eq(photos.boxId, row.boxId), isNull(photos.deletedAt)))
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
    // If this photo's analysis was still pending, the box must not stay "pending" for it.
    const [pend] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(photos)
      .where(
        and(eq(photos.boxId, row.boxId), eq(photos.aiStatus, 'pending'), isNull(photos.deletedAt)),
      );
    if (Number(pend?.n ?? 0) === 0) {
      await tx
        .update(boxes)
        .set({
          aiStatus: sql`CASE WHEN ${boxes.aiStatus} = 'pending' THEN 'done'::ai_status ELSE ${boxes.aiStatus} END`,
        })
        .where(eq(boxes.id, row.boxId));
    }
    await refreshBoxSearchVector(tx, row.boxId);
  });
  return row.boxId;
}

/** Brings a trashed photo back (appended at the end of the box's photo strip). */
export async function restorePhoto(db: Db, id: number): Promise<Photo> {
  const row = await getPhotoRow(db, id);
  if (!row.deletedAt) return mapPhoto(row);
  const [box] = await db
    .select({ deletedAt: boxes.deletedAt })
    .from(boxes)
    .where(eq(boxes.id, row.boxId))
    .limit(1);
  if (box?.deletedAt) throw conflict('Restore the box first — it is in the Trash');
  const [mx] = await db
    .select({ max: sql<number | null>`max(${photos.sortOrder})` })
    .from(photos)
    .where(and(eq(photos.boxId, row.boxId), isNull(photos.deletedAt)));
  const [updated] = await db
    .update(photos)
    .set({ deletedAt: null, sortOrder: Number(mx?.max ?? -1) + 1 })
    .where(eq(photos.id, id))
    .returning();
  await refreshBoxSearchVector(db, row.boxId);
  return mapPhoto(updated!);
}

/** Permanently deletes a photo row; returns its file paths (remove them after the row is gone). */
export async function purgePhoto(
  db: Db,
  id: number,
): Promise<{ photoPaths: string[]; boxId: number }> {
  const row = await getPhotoRow(db, id);
  if (!row.deletedAt) await trashPhoto(db, id); // detach items / rebuild description first
  await db.delete(photos).where(eq(photos.id, id));
  return { photoPaths: [row.originalPath, row.thumbPath], boxId: row.boxId };
}

/** Photos in the Trash whose box is still live (trashed boxes list as boxes). */
export async function listTrashedPhotos(db: Db) {
  return db
    .select({ photo: photos, boxLabelId: boxes.labelId, boxName: boxes.name })
    .from(photos)
    .innerJoin(boxes, eq(boxes.id, photos.boxId))
    .where(and(isNotNull(photos.deletedAt), isNull(boxes.deletedAt)))
    .orderBy(sql`${photos.deletedAt} DESC`);
}

/**
 * Rescan: moves every photo of a box to the Trash and drops its AI-derived items and description
 * (manual items stay). Nothing is deleted from disk here — purge does that after the retention period.
 */
export async function clearBoxPhotos(db: Db, boxId: number): Promise<{ photoPaths: string[] }> {
  await db.transaction(async (tx) => {
    await tx.delete(items).where(and(eq(items.boxId, boxId), eq(items.source, 'ai')));
    await tx
      .update(photos)
      .set({ deletedAt: sql`now()` as unknown as Date })
      .where(and(eq(photos.boxId, boxId), isNull(photos.deletedAt)));
    await tx
      .update(boxes)
      .set({ aiDescription: null, aiStatus: 'none', aiError: null })
      .where(eq(boxes.id, boxId));
    await refreshBoxSearchVector(tx, boxId);
  });
  return { photoPaths: [] };
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
