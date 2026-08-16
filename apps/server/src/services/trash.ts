import { TRASH_RETENTION_DAYS, type TrashContents } from '@totetrack/shared';
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { boxes, locations, photos, preprintedLabels } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { boxSummaryColumns, mapPhoto, mapSummary } from './boxes.js';
import { listTrashedPhotos, removeFiles, type PhotoStorage } from './photos.js';

export { TRASH_RETENTION_DAYS };

export async function listTrash(db: Db): Promise<TrashContents> {
  const boxRows = await db
    .select(boxSummaryColumns)
    .from(boxes)
    .leftJoin(locations, eq(locations.id, boxes.locationId))
    .where(isNotNull(boxes.deletedAt))
    .orderBy(sql`${boxes.deletedAt} DESC`);
  const photoRows = await listTrashedPhotos(db);
  return {
    boxes: boxRows.map(mapSummary),
    photos: photoRows.map((r) => ({
      ...mapPhoto(r.photo),
      boxLabelId: r.boxLabelId,
      boxName: r.boxName,
    })),
    retentionDays: TRASH_RETENTION_DAYS,
  };
}

/**
 * Permanently removes everything in the Trash older than the retention period (or everything when
 * `all` is set). Files are removed after the rows are gone, so a crash can only leave orphan files
 * (harmless), never dangling rows.
 */
export async function purgeTrash(
  db: Db,
  storage: PhotoStorage,
  opts: { all?: boolean } = {},
): Promise<{ boxes: number; photos: number }> {
  const cutoff = sql`now() - make_interval(days => ${TRASH_RETENTION_DAYS})`;
  const boxCond = opts.all ? isNotNull(boxes.deletedAt) : lt(boxes.deletedAt, cutoff);
  const photoCond = opts.all ? isNotNull(photos.deletedAt) : lt(photos.deletedAt, cutoff);

  const files: string[] = [];
  const result = await db.transaction(async (tx) => {
    // Boxes first: their photos (trashed or not) go with them.
    const doomedBoxes = await tx.select({ id: boxes.id }).from(boxes).where(boxCond);
    const boxIds = doomedBoxes.map((b) => b.id);
    if (boxIds.length) {
      const ph = await tx
        .select({ o: photos.originalPath, t: photos.thumbPath })
        .from(photos)
        .where(sql`${photos.boxId} IN ${boxIds}`);
      files.push(...ph.flatMap((p) => [p.o, p.t]));
      await tx
        .update(preprintedLabels)
        .set({ claimedBoxId: null, claimedAt: null })
        .where(sql`${preprintedLabels.claimedBoxId} IN ${boxIds}`);
      await tx.delete(boxes).where(sql`${boxes.id} IN ${boxIds}`);
    }
    // Then trashed photos of live boxes.
    const doomedPhotos = await tx
      .delete(photos)
      .where(
        and(
          photoCond,
          isNull(sql`(SELECT b.deleted_at FROM boxes b WHERE b.id = ${photos.boxId})`),
        ),
      )
      .returning({ o: photos.originalPath, t: photos.thumbPath });
    files.push(...doomedPhotos.flatMap((p) => [p.o, p.t]));
    return { boxes: boxIds.length, photos: doomedPhotos.length };
  });
  await removeFiles(storage, files);
  if (result.boxes || result.photos) logger.info(result, 'trash purged');
  return result;
}

/** Runs the expiry purge now and then every `everyMs` (timer is unref'd so it never keeps the process alive). */
export function schedulePurge(db: Db, storage: PhotoStorage, everyMs = 6 * 60 * 60 * 1000) {
  const run = () =>
    purgeTrash(db, storage).catch((err) => logger.error({ err }, 'trash purge failed'));
  void run();
  const t = setInterval(run, everyMs);
  t.unref();
  return () => clearInterval(t);
}
