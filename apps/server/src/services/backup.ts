import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import { ZipArchive, type ArchiverError } from 'archiver';
import yauzl from 'yauzl';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupManifest,
  type BackupRestoreResult,
} from '@totetrack/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  boxes,
  items,
  locations,
  photos,
  preprintedLabels,
  series,
  settings,
} from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { PhotoStorage } from './photos.js';
import { refreshAllSearchVectors } from './search-vector.js';
import { SETTING_KEYS } from './settings.js';

/**
 * Never in a backup: secrets don't leave the app through the API, and the PIN/session generation
 * belong to the install being restored INTO (so a restore can't lock you out with an old PIN).
 */
export const OMITTED_SETTINGS: string[] = [
  SETTING_KEYS.aiApiKey,
  SETTING_KEYS.tunnelToken,
  SETTING_KEYS.sessionSecret,
  SETTING_KEYS.pinHash,
  SETTING_KEYS.sessionGeneration,
];

const TABLES = [
  'series',
  'locations',
  'boxes',
  'photos',
  'items',
  'preprinted_labels',
  'settings',
] as const;
type TableName = (typeof TABLES)[number];

/** Derived columns: never dumped, never inserted. */
const DERIVED_COLUMNS: Partial<Record<TableName, string[]>> = {
  boxes: ['label_id', 'search_vector'],
};

/** Row shape as stored in the archive: raw column names, ISO strings for timestamps. */
type RawRow = Record<string, unknown>;

async function dump(db: Db, table: TableName): Promise<RawRow[]> {
  const res = await db.execute<RawRow>(sql.raw(`SELECT * FROM ${table} ORDER BY 1`));
  const skip = new Set(DERIVED_COLUMNS[table] ?? []);
  const out: RawRow[] = [];
  for (const r of res.rows) {
    if (table === 'settings' && OMITTED_SETTINGS.includes(String(r.key))) continue;
    const row: RawRow = {};
    for (const [k, v] of Object.entries(r)) {
      if (skip.has(k)) continue;
      row[k] = v instanceof Date ? v.toISOString() : v;
    }
    out.push(row);
  }
  return out;
}

/**
 * Streams a zip: manifest.json, data/<table>.json for every table, photos/<original path> for every
 * photo file that exists on disk (missing files are logged, not fatal).
 */
export async function writeBackup(
  db: Db,
  storage: PhotoStorage,
  out: Writable,
  appVersion: string,
): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const done = pipeline(archive, out);
  archive.on('warning', (err: ArchiverError) => logger.warn({ err }, 'backup archive warning'));

  const counts: Record<string, number> = {};
  const data: Partial<Record<TableName, RawRow[]>> = {};
  for (const t of TABLES) {
    data[t] = await dump(db, t);
    counts[t] = data[t]!.length;
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    createdAt: new Date().toISOString(),
    counts,
    omittedSettings: OMITTED_SETTINGS,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  for (const t of TABLES) archive.append(JSON.stringify(data[t]), { name: `data/${t}.json` });

  for (const p of data.photos ?? []) {
    for (const rel of [p.original_path, p.thumb_path]) {
      if (typeof rel !== 'string') continue;
      const abs = storage.resolve(rel);
      try {
        await fs.access(abs);
        archive.file(abs, { name: `photos/${rel}` });
      } catch {
        logger.warn({ rel }, 'backup: photo file missing, skipped');
      }
    }
  }
  await archive.finalize();
  await done;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

const SAFE_PHOTO_PATH = /^\d+\/[A-Za-z0-9._-]+$/;

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) =>
      err ? reject(err) : resolve(zip),
    );
  });
}
function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}
async function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  const stream = await openEntry(zip, entry);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
/** Walks all entries (yauzl lazy mode) and calls fn for each. */
function eachEntry(zip: yauzl.ZipFile, fn: (e: yauzl.Entry) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      fn(entry)
        .then(() => zip.readEntry())
        .catch(reject);
    });
    zip.on('end', () => resolve());
    zip.on('error', (err: Error) => reject(badRequest(`Corrupt zip archive: ${err.message}`)));
    zip.readEntry();
  });
}

const MAX_JSON_BYTES = 512 * 1024 * 1024;

/**
 * Replaces ALL data with the archive's contents (ids preserved, sequences reset). Photo files are
 * extracted to a staging directory first and swapped in only after the database transaction
 * commits, so a bad archive leaves the current data untouched.
 */
export async function restoreBackup(
  db: Db,
  storage: PhotoStorage,
  zipPath: string,
): Promise<BackupRestoreResult> {
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(zipPath);
  } catch (err) {
    throw badRequest(`Not a zip archive: ${err instanceof Error ? err.message : String(err)}`);
  }
  const staging = path.join(storage.root, `.restore-${process.pid}-${Date.now()}`);
  await fs.mkdir(staging, { recursive: true });
  const jsonEntries = new Map<string, yauzl.Entry>();
  const photoFiles = new Set<string>();
  try {
    // Pass 1: index JSON entries, extract photo files to staging.
    await eachEntry(zip, async (entry) => {
      const name = entry.fileName;
      if (name.endsWith('/')) return; // directory
      if (name === 'manifest.json' || /^data\/[a-z_]+\.json$/.test(name)) {
        if (entry.uncompressedSize > MAX_JSON_BYTES) throw badRequest(`${name} is too large`);
        jsonEntries.set(name, entry);
        return;
      }
      if (name.startsWith('photos/')) {
        const rel = name.slice('photos/'.length);
        if (!SAFE_PHOTO_PATH.test(rel)) throw badRequest(`Unsafe photo path in archive: ${name}`);
        const dest = path.join(staging, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await pipeline(await openEntry(zip, entry), createWriteStream(dest));
        photoFiles.add(rel);
      }
      // anything else is ignored
    });

    const manifestEntry = jsonEntries.get('manifest.json');
    if (!manifestEntry) throw badRequest('Not a ToteTrack backup (manifest.json missing)');
    const manifestParsed = BackupManifest.safeParse(
      JSON.parse((await readEntry(zip, manifestEntry)).toString('utf8')),
    );
    if (!manifestParsed.success) throw badRequest('Not a ToteTrack backup (bad manifest)');
    const manifest = manifestParsed.data;
    if (manifest.formatVersion > BACKUP_FORMAT_VERSION)
      throw badRequest(
        `This backup was made by a newer ToteTrack (format v${manifest.formatVersion}); update the app first`,
      );

    const tables: Partial<Record<TableName, RawRow[]>> = {};
    for (const t of TABLES) {
      const e = jsonEntries.get(`data/${t}.json`);
      if (!e) throw badRequest(`Backup is missing data/${t}.json`);
      const rows = JSON.parse((await readEntry(zip, e)).toString('utf8')) as unknown;
      if (!Array.isArray(rows)) throw badRequest(`data/${t}.json is not an array`);
      tables[t] = rows as RawRow[];
    }

    // Pass 2: database — everything or nothing.
    const restored: Record<string, number> = {};
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`TRUNCATE TABLE items, photos, preprinted_labels, boxes, locations, series RESTART IDENTITY CASCADE`,
      );
      // Settings: replace only the keys present in the archive (secrets/PIN of THIS install may stay).
      const settingRows = tables.settings ?? [];
      const keys = settingRows.map((r) => String(r.key));
      if (keys.length) await tx.execute(sql`DELETE FROM settings WHERE key IN ${keys}`);
      for (const r of settingRows) {
        await tx.insert(settings).values({
          key: String(r.key),
          value: String(r.value ?? ''),
          updatedAt: r.updated_at ? new Date(String(r.updated_at)) : new Date(),
        });
      }
      restored.settings = settingRows.length;

      const insertRows = async (table: TableName, rows: RawRow[]) => {
        for (const chunk of chunks(rows, 200)) {
          const first = chunk[0]!;
          const cols = Object.keys(first);
          const colSql = sql.raw(cols.map((c) => `"${c}"`).join(', '));
          const values = sql.join(
            chunk.map(
              (r) =>
                sql`(${sql.join(
                  cols.map((c) => sql`${r[c] === undefined ? null : r[c]}`),
                  sql`, `,
                )})`,
            ),
            sql`, `,
          );
          await tx.execute(sql`INSERT INTO ${sql.raw(table)} (${colSql}) VALUES ${values}`);
        }
        restored[table] = rows.length;
        // Sequences: serial columns are named <table>_id_seq
        if (rows.length)
          await tx.execute(
            sql.raw(
              `SELECT setval('${table}_id_seq', (SELECT COALESCE(MAX(id), 1) FROM ${table}), (SELECT COUNT(*) > 0 FROM ${table}))`,
            ),
          );
      };
      await insertRows('series', normalizeRows('series', series, tables.series ?? []));
      await insertRows('locations', normalizeRows('locations', locations, tables.locations ?? []));
      await insertRows('boxes', normalizeRows('boxes', boxes, tables.boxes ?? []));
      await insertRows('photos', normalizeRows('photos', photos, tables.photos ?? []));
      await insertRows('items', normalizeRows('items', items, tables.items ?? []));
      await insertRows(
        'preprinted_labels',
        normalizeRows('preprinted_labels', preprintedLabels, tables.preprinted_labels ?? []),
      );
      await refreshAllSearchVectors(tx);
    });

    // Pass 3: swap photo files in (DB is already committed; worst case = missing files → 404s).
    const oldDirs = (await fs.readdir(storage.root, { withFileTypes: true })).filter(
      (d) => d.isDirectory() && /^\d+$/.test(d.name),
    );
    for (const d of oldDirs)
      await fs.rm(path.join(storage.root, d.name), { recursive: true, force: true });
    let moved = 0;
    for (const rel of photoFiles) {
      const dest = storage.resolve(rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(path.join(staging, rel), dest);
      moved++;
    }
    const expected = (tables.photos ?? []).flatMap((p) => [p.original_path, p.thumb_path]);
    const missing = expected.filter(
      (rel) => typeof rel === 'string' && !photoFiles.has(rel),
    ).length;
    logger.info({ restored, moved, missing }, 'backup restored');
    return { restored, photoFiles: moved, missingPhotoFiles: missing, manifest };
  } finally {
    zip.close();
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function* chunks<T>(arr: T[], n: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}

/** Keeps only columns that exist in the current schema (forward-compat with older dumps). */
function normalizeRows(tableName: TableName, table: object, rows: RawRow[]): RawRow[] {
  const skip = new Set(DERIVED_COLUMNS[tableName] ?? []);
  const known = new Set<string>();
  for (const col of Object.values(table)) {
    if (col && typeof col === 'object' && 'name' in col && typeof col.name === 'string')
      known.add(col.name);
  }
  return rows.map((r) => {
    const out: RawRow = {};
    for (const [k, v] of Object.entries(r)) if (known.has(k) && !skip.has(k)) out[k] = v;
    return out;
  });
}
