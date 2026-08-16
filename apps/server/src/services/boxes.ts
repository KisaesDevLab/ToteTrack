import type {
  BoxCreateInput,
  BoxDetail,
  BoxListQuery,
  BoxSummary,
  BoxUpdateInput,
  Item,
  Photo,
} from '@totetrack/shared';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../db/index.js';
import { boxes, items, locations, photos, series } from '../db/schema.js';
import type { ItemRow, PhotoRow } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { claimPreprinted } from './preprint.js';
import { refreshBoxSearchVector } from './search-vector.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function photoUrls(id: number) {
  return { originalUrl: `/api/photos/${id}/original`, thumbUrl: `/api/photos/${id}/thumb` };
}

export function mapPhoto(p: PhotoRow): Photo {
  return {
    id: p.id,
    boxId: p.boxId,
    sortOrder: p.sortOrder,
    width: p.width,
    height: p.height,
    aiStatus: p.aiStatus,
    aiError: p.aiError,
    createdAt: p.createdAt.toISOString(),
    ...photoUrls(p.id),
  };
}

export function mapItem(i: ItemRow): Item {
  return {
    id: i.id,
    boxId: i.boxId,
    name: i.name,
    qty: i.qty,
    note: i.note,
    source: i.source,
    photoId: i.photoId,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

// --- summary select --------------------------------------------------------

const photoCountSql = sql<number>`(SELECT count(*)::int FROM photos p WHERE p.box_id = ${boxes.id})`;
const itemCountSql = sql<number>`(SELECT count(*)::int FROM items i WHERE i.box_id = ${boxes.id})`;
const firstPhotoIdSql = sql<
  number | null
>`(SELECT p.id FROM photos p WHERE p.box_id = ${boxes.id} ORDER BY p.sort_order, p.id LIMIT 1)`;

export const boxSummaryColumns = {
  id: boxes.id,
  seriesId: boxes.seriesId,
  seriesLetter: boxes.seriesLetter,
  number: boxes.number,
  labelId: boxes.labelId,
  name: boxes.name,
  locationId: boxes.locationId,
  locationName: locations.name,
  status: boxes.status,
  aiStatus: boxes.aiStatus,
  aiError: boxes.aiError,
  aiDescription: boxes.aiDescription,
  printedAt: boxes.printedAt,
  createdAt: boxes.createdAt,
  updatedAt: boxes.updatedAt,
  photoCount: photoCountSql,
  itemCount: itemCountSql,
  firstPhotoId: firstPhotoIdSql,
};

type SummaryRow = {
  id: number;
  seriesId: number;
  seriesLetter: string;
  number: number;
  labelId: string;
  name: string | null;
  locationId: number | null;
  locationName: string | null;
  status: 'open' | 'sealed';
  aiStatus: 'none' | 'pending' | 'done' | 'error';
  aiError: string | null;
  aiDescription: string | null;
  printedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  photoCount: number;
  itemCount: number;
  firstPhotoId: number | null;
};

export function mapSummary(r: SummaryRow): BoxSummary {
  return {
    id: r.id,
    seriesId: r.seriesId,
    seriesLetter: r.seriesLetter,
    number: r.number,
    labelId: r.labelId,
    name: r.name,
    locationId: r.locationId,
    locationName: r.locationName,
    status: r.status,
    aiStatus: r.aiStatus,
    aiError: r.aiError,
    aiDescription: r.aiDescription,
    photoCount: Number(r.photoCount),
    itemCount: Number(r.itemCount),
    thumbUrl: r.firstPhotoId ? photoUrls(r.firstPhotoId).thumbUrl : null,
    printedAt: iso(r.printedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function summaryQuery(db: Db | Tx) {
  return db
    .select(boxSummaryColumns)
    .from(boxes)
    .leftJoin(locations, eq(locations.id, boxes.locationId));
}

// --- queries ---------------------------------------------------------------

export async function listBoxes(db: Db, q: BoxListQuery): Promise<BoxSummary[]> {
  const where: SQL[] = [];
  if (q.locationId) where.push(eq(boxes.locationId, q.locationId));
  if (q.seriesId) where.push(eq(boxes.seriesId, q.seriesId));
  if (q.status) where.push(eq(boxes.status, q.status));
  if (q.unprinted) where.push(isNull(boxes.printedAt));

  const order =
    q.sort === 'recent'
      ? [desc(boxes.updatedAt)]
      : q.sort === 'name'
        ? [asc(boxes.name), asc(boxes.seriesLetter), asc(boxes.number)]
        : [asc(boxes.seriesLetter), asc(boxes.number)];

  const rows = await summaryQuery(db)
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .limit(q.limit ?? 500)
    .offset(q.offset ?? 0);
  return rows.map(mapSummary);
}

export async function listBoxesByIds(db: Db, ids: number[]): Promise<BoxSummary[]> {
  if (ids.length === 0) return [];
  const rows = await summaryQuery(db)
    .where(inArray(boxes.id, ids))
    .orderBy(asc(boxes.seriesLetter), asc(boxes.number));
  return rows.map(mapSummary);
}

export async function getBoxSummary(db: Db | Tx, id: number): Promise<BoxSummary | null> {
  const [row] = await summaryQuery(db).where(eq(boxes.id, id)).limit(1);
  return row ? mapSummary(row) : null;
}

export async function getBoxSummaryByLabel(db: Db, labelId: string): Promise<BoxSummary | null> {
  const [row] = await summaryQuery(db)
    .where(sql`upper(${boxes.labelId}) = upper(${labelId})`)
    .limit(1);
  return row ? mapSummary(row) : null;
}

export async function getBoxDetail(db: Db, id: number): Promise<BoxDetail | null> {
  const summary = await getBoxSummary(db, id);
  if (!summary) return null;
  const [photoRows, itemRows] = await Promise.all([
    db
      .select()
      .from(photos)
      .where(eq(photos.boxId, id))
      .orderBy(asc(photos.sortOrder), asc(photos.id)),
    db.select().from(items).where(eq(items.boxId, id)).orderBy(asc(items.id)),
  ]);
  return { ...summary, photos: photoRows.map(mapPhoto), items: itemRows.map(mapItem) };
}

export async function requireBox(db: Db | Tx, id: number) {
  const [row] = await db.select().from(boxes).where(eq(boxes.id, id)).limit(1);
  if (!row) throw notFound('Box not found');
  return row;
}

// --- mutations -------------------------------------------------------------

export async function createBox(db: Db, input: BoxCreateInput): Promise<BoxSummary> {
  const id = await db.transaction(async (tx) => {
    // Lock the series row so concurrent creates get distinct numbers.
    const [s] = await tx
      .select()
      .from(series)
      .where(eq(series.id, input.seriesId))
      .for('update')
      .limit(1);
    if (!s) throw badRequest('Series not found');
    if (input.locationId) await requireLocation(tx, input.locationId);

    const number = input.number ?? s.nextNumber;
    if (input.number !== undefined) {
      const [taken] = await tx
        .select({ id: boxes.id })
        .from(boxes)
        .where(and(eq(boxes.seriesId, s.id), eq(boxes.number, input.number)))
        .limit(1);
      if (taken)
        throw conflict(
          `Label ${s.letter}-${String(input.number).padStart(3, '0')} is already in use`,
        );
    }
    const [created] = await tx
      .insert(boxes)
      .values({
        seriesId: s.id,
        seriesLetter: s.letter,
        number,
        name: input.name?.trim() || null,
        locationId: input.locationId ?? null,
        status: input.status ?? 'open',
      })
      .returning({ id: boxes.id });
    if (number >= s.nextNumber) {
      await tx
        .update(series)
        .set({ nextNumber: number + 1 })
        .where(eq(series.id, s.id));
    }
    await claimPreprinted(tx, s.id, number, created!.id);
    await refreshBoxSearchVector(tx, created!.id);
    return created!.id;
  });
  return (await getBoxSummary(db, id))!;
}

export async function updateBox(db: Db, id: number, input: BoxUpdateInput): Promise<BoxSummary> {
  await db.transaction(async (tx) => {
    await requireBox(tx, id);
    if (input.locationId) await requireLocation(tx, input.locationId);
    const set: Partial<typeof boxes.$inferInsert> = { updatedAt: sql`now()` as unknown as Date };
    if (input.name !== undefined) set.name = input.name?.trim() || null;
    if (input.locationId !== undefined) set.locationId = input.locationId;
    if (input.status !== undefined) set.status = input.status;
    if (input.aiDescription !== undefined) set.aiDescription = input.aiDescription;
    await tx.update(boxes).set(set).where(eq(boxes.id, id));
    await refreshBoxSearchVector(tx, id);
  });
  return (await getBoxSummary(db, id))!;
}

export async function setBoxStatus(
  db: Db,
  id: number,
  status: 'open' | 'sealed',
): Promise<BoxSummary> {
  return updateBox(db, id, { status });
}

export async function toggleBoxStatus(db: Db, id: number): Promise<BoxSummary> {
  const row = await requireBox(db, id);
  return updateBox(db, id, { status: row.status === 'open' ? 'sealed' : 'open' });
}

export async function deleteBox(db: Db, id: number): Promise<{ photoPaths: string[] }> {
  return db.transaction(async (tx) => {
    await requireBox(tx, id);
    const photoRows = await tx.select().from(photos).where(eq(photos.boxId, id));
    await tx.delete(boxes).where(eq(boxes.id, id));
    return { photoPaths: photoRows.flatMap((p) => [p.originalPath, p.thumbPath]) };
  });
}

export async function markBoxesPrinted(db: Db, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db
    .update(boxes)
    .set({ printedAt: sql`now()` as unknown as Date })
    .where(inArray(boxes.id, ids));
}

async function requireLocation(tx: Db | Tx, id: number) {
  const [l] = await tx.select().from(locations).where(eq(locations.id, id)).limit(1);
  if (!l) throw badRequest('Location not found');
  return l;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export function rethrowUnique(err: unknown, message: string): never {
  if (isUniqueViolation(err)) throw conflict(message);
  throw err;
}
