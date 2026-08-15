import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/index.js';

type Executor = Db | Tx;

/**
 * Rebuilds `boxes.search_vector` for one box from label, name, location name,
 * AI description and aggregated item names/notes. Called app-side inside the
 * same transaction as any write that affects those fields.
 */
export async function refreshBoxSearchVector(ex: Executor, boxId: number): Promise<void> {
  await ex.execute(sql`
    UPDATE boxes SET
      search_vector =
        setweight(to_tsvector('simple', label_id), 'A') ||
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce((SELECT l.name FROM locations l WHERE l.id = boxes.location_id), '')), 'B') ||
        setweight(to_tsvector('english', coalesce((SELECT string_agg(i.name || ' ' || coalesce(i.note, ''), ' ') FROM items i WHERE i.box_id = boxes.id), '')), 'B') ||
        setweight(to_tsvector('english', coalesce(ai_description, '')), 'C'),
      updated_at = now()
    WHERE id = ${boxId}
  `);
}

/** Refresh every box in a location (after a location rename). */
export async function refreshSearchVectorsForLocation(
  ex: Executor,
  locationId: number,
): Promise<void> {
  const rows = await ex.execute<{ id: number }>(
    sql`SELECT id FROM boxes WHERE location_id = ${locationId}`,
  );
  for (const r of rows.rows) await refreshBoxSearchVector(ex, r.id);
}

/** Refresh all boxes (used by seed and as a maintenance hook). */
export async function refreshAllSearchVectors(ex: Executor): Promise<void> {
  const rows = await ex.execute<{ id: number }>(sql`SELECT id FROM boxes`);
  for (const r of rows.rows) await refreshBoxSearchVector(ex, r.id);
}
