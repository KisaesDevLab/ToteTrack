import { LABEL_ID_REGEX, type SearchQuery, type SearchResult } from '@totetrack/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { photoUrls } from './boxes.js';

type Row = {
  id: number;
  series_id: number;
  series_letter: string;
  number: number;
  label_id: string;
  name: string | null;
  location_id: number | null;
  location_name: string | null;
  status: 'open' | 'sealed';
  ai_status: 'none' | 'pending' | 'done' | 'error';
  ai_error: string | null;
  ai_description: string | null;
  printed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  photo_count: number;
  item_count: number;
  first_photo_id: number | null;
  rank: number;
  label_exact: boolean;
  m_label: boolean;
  m_name: boolean;
  m_location: boolean;
  m_desc: boolean;
  m_items: boolean;
  headline: string | null;
};

export async function searchBoxes(db: Db, q: SearchQuery): Promise<SearchResult[]> {
  const term = q.q.trim();
  const filters: SQL[] = [];
  if (q.locationId) filters.push(sql`b.location_id = ${q.locationId}`);
  if (q.status) filters.push(sql`b.status = ${q.status}`);

  // Partial-label support: "a1" / "A-1" → letter A, number prefix "1".
  const labelMatch = LABEL_ID_REGEX.exec(term);
  const labelLetter = labelMatch ? labelMatch[1]!.toUpperCase() : null;
  const labelDigits = labelMatch ? String(Number.parseInt(labelMatch[2]!, 10)) : null;

  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const hasTerm = term.length > 0;

  const labelPrefixCond = labelLetter
    ? sql`(b.series_letter = ${labelLetter} AND b.number::text LIKE ${labelDigits + '%'})`
    : sql`false`;
  const labelExactCond = labelLetter
    ? sql`(b.series_letter = ${labelLetter} AND b.number = ${Number.parseInt(labelDigits!, 10)})`
    : sql`false`;

  const matchClause = hasTerm
    ? sql`(
        b.search_vector @@ websearch_to_tsquery('english', ${term})
        OR ${labelPrefixCond}
        OR b.label_id ILIKE ${like}
        OR b.name ILIKE ${like}
        OR l.name ILIKE ${like}
        OR b.ai_description ILIKE ${like}
        OR EXISTS (SELECT 1 FROM items i WHERE i.box_id = b.id AND (i.name ILIKE ${like} OR i.note ILIKE ${like}))
      )`
    : sql`true`;

  const where = [matchClause, ...filters].reduce((acc, c) => sql`${acc} AND ${c}`);

  const rankExpr = hasTerm
    ? sql`ts_rank_cd(b.search_vector, websearch_to_tsquery('english', ${term}))`
    : sql`0::float4`;
  const headlineExpr = hasTerm
    ? sql`ts_headline('english',
          replace(replace(replace(
            coalesce(b.ai_description, '') || ' ' || coalesce((SELECT string_agg(i.name || coalesce(' — ' || i.note, ''), '; ') FROM items i WHERE i.box_id = b.id), ''),
          '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
          websearch_to_tsquery('english', ${term}),
          'MaxWords=20, MinWords=8, ShortWord=2, MaxFragments=1, StartSel=<b>, StopSel=</b>')`
    : sql`NULL::text`;

  const result = await db.execute<Row>(sql`
    SELECT
      b.id, b.series_id, b.series_letter, b.number, b.label_id, b.name, b.location_id,
      l.name AS location_name, b.status, b.ai_status, b.ai_error, b.ai_description,
      b.printed_at, b.created_at, b.updated_at,
      (SELECT count(*)::int FROM photos p WHERE p.box_id = b.id) AS photo_count,
      (SELECT count(*)::int FROM items i WHERE i.box_id = b.id) AS item_count,
      (SELECT p.id FROM photos p WHERE p.box_id = b.id ORDER BY p.sort_order, p.id LIMIT 1) AS first_photo_id,
      ${rankExpr} AS rank,
      ${labelExactCond} AS label_exact,
      (${hasTerm} AND (${labelPrefixCond} OR b.label_id ILIKE ${like})) AS m_label,
      (${hasTerm} AND b.name ILIKE ${like}) AS m_name,
      (${hasTerm} AND l.name ILIKE ${like}) AS m_location,
      (${hasTerm} AND b.ai_description ILIKE ${like}) AS m_desc,
      (${hasTerm} AND EXISTS (SELECT 1 FROM items i WHERE i.box_id = b.id AND (i.name ILIKE ${like} OR i.note ILIKE ${like}))) AS m_items,
      ${headlineExpr} AS headline
    FROM boxes b
    LEFT JOIN locations l ON l.id = b.location_id
    WHERE ${where}
    ORDER BY label_exact DESC, rank DESC, b.updated_at DESC
    LIMIT ${q.limit}
  `);

  return result.rows.map((r) => {
    const matched: string[] = [];
    if (r.label_exact || r.m_label) matched.push('label');
    if (r.m_name) matched.push('name');
    if (r.m_location) matched.push('location');
    if (r.m_items) matched.push('items');
    if (r.m_desc) matched.push('description');
    if (hasTerm && matched.length === 0 && Number(r.rank) > 0) matched.push('text');
    const headline = r.headline && /<b>/.test(r.headline) ? r.headline : null;
    return {
      id: r.id,
      seriesId: r.series_id,
      seriesLetter: r.series_letter,
      number: r.number,
      labelId: r.label_id,
      name: r.name,
      locationId: r.location_id,
      locationName: r.location_name,
      status: r.status,
      aiStatus: r.ai_status,
      aiError: r.ai_error,
      aiDescription: r.ai_description,
      photoCount: Number(r.photo_count),
      itemCount: Number(r.item_count),
      thumbUrl: r.first_photo_id ? photoUrls(r.first_photo_id).thumbUrl : null,
      printedAt: r.printed_at ? new Date(r.printed_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      rank: Number(r.rank),
      matchedFields: matched,
      headline,
    };
  });
}
