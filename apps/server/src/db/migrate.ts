import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './index.js';

/**
 * Locate the committed migrations folder both in dev (src/db → ../../drizzle)
 * and in the bundled build (dist/index.js → ../drizzle).
 */
export function migrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'meta', '_journal.json'))) return c;
  }
  return candidates[0]!;
}

export async function runMigrations(db: Db): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
