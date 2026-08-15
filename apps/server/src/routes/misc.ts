import { SearchQuery, SettingsUpdateInput } from '@totetrack/shared';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/index.js';
import { boxes, items, locations } from '../db/schema.js';
import type { Env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { asyncHandler, parseBody, parseQuery } from '../lib/http.js';
import type { AiService } from '../services/ai.js';
import { boxSummaryColumns } from '../services/boxes.js';
import { DEFAULT_LABEL_TEMPLATE, LABEL_TEMPLATES } from '../services/labels.js';
import { searchBoxes } from '../services/search.js';
import { getSettings, SETTING_KEYS, setSetting } from '../services/settings.js';

export function searchRouter(db: Db): Router {
  const r = Router();
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const q = parseQuery(SearchQuery, req.query);
      res.json(await searchBoxes(db, q));
    }),
  );
  return r;
}

// --- settings ----------------------------------------------------------------

export function settingsRouter(db: Db, env: Env, ai: AiService, version: string): Router {
  const r = Router();

  const read = async () => {
    const s = await getSettings(db);
    return {
      aiModel: s[SETTING_KEYS.aiModel] ?? env.ANTHROPIC_MODEL,
      aiAutoAnalyze: (s[SETTING_KEYS.aiAutoAnalyze] ?? 'true') === 'true',
      aiAvailable: ai.available,
      defaultLabelTemplate: s[SETTING_KEYS.defaultLabelTemplate] ?? DEFAULT_LABEL_TEMPLATE,
      publicUrl: env.PUBLIC_URL,
      version,
    };
  };

  r.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await read());
    }),
  );

  r.patch(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseBody(SettingsUpdateInput, req.body);
      if (input.aiModel !== undefined) await setSetting(db, SETTING_KEYS.aiModel, input.aiModel);
      if (input.aiAutoAnalyze !== undefined)
        await setSetting(db, SETTING_KEYS.aiAutoAnalyze, input.aiAutoAnalyze ? 'true' : 'false');
      if (input.defaultLabelTemplate !== undefined) {
        if (!LABEL_TEMPLATES[input.defaultLabelTemplate])
          throw badRequest('Unknown label template');
        await setSetting(db, SETTING_KEYS.defaultLabelTemplate, input.defaultLabelTemplate);
      }
      res.json(await read());
    }),
  );

  return r;
}

// --- CSV export ----------------------------------------------------------------

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Neutralise spreadsheet formula injection, then quote if needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csv(rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 correctly; CRLF line endings.
  return '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

export function exportRouter(db: Db): Router {
  const r = Router();

  r.get(
    '/boxes.csv',
    asyncHandler(async (_req, res) => {
      const rows = await db
        .select(boxSummaryColumns)
        .from(boxes)
        .leftJoin(locations, eq(locations.id, boxes.locationId))
        .orderBy(asc(boxes.seriesLetter), asc(boxes.number));
      const out = [
        [
          'label',
          'name',
          'location',
          'status',
          'description',
          'photo_count',
          'item_count',
          'created_at',
          'updated_at',
        ],
        ...rows.map((b) => [
          b.labelId,
          b.name,
          b.locationName,
          b.status,
          b.aiDescription,
          Number(b.photoCount),
          Number(b.itemCount),
          b.createdAt.toISOString(),
          b.updatedAt.toISOString(),
        ]),
      ];
      res.type('text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="totetrack-boxes.csv"');
      res.send(csv(out));
    }),
  );

  r.get(
    '/items.csv',
    asyncHandler(async (_req, res) => {
      const rows = await db
        .select({
          label: boxes.labelId,
          boxName: boxes.name,
          location: locations.name,
          item: items.name,
          qty: items.qty,
          note: items.note,
          source: items.source,
        })
        .from(items)
        .innerJoin(boxes, eq(boxes.id, items.boxId))
        .leftJoin(locations, eq(locations.id, boxes.locationId))
        .orderBy(asc(boxes.seriesLetter), asc(boxes.number), asc(items.id));
      const out = [
        ['label', 'box_name', 'location', 'item', 'qty', 'note', 'source'],
        ...rows.map((i) => [i.label, i.boxName, i.location, i.item, i.qty, i.note, i.source]),
      ];
      res.type('text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="totetrack-items.csv"');
      res.send(csv(out));
    }),
  );

  // One denormalised file: a row per item with the box columns repeated; boxes without items get one row.
  r.get(
    '/inventory.csv',
    asyncHandler(async (_req, res) => {
      const rows = await db
        .select({
          label: boxes.labelId,
          boxName: boxes.name,
          location: locations.name,
          status: boxes.status,
          description: boxes.aiDescription,
          item: items.name,
          qty: items.qty,
          note: items.note,
          source: items.source,
        })
        .from(boxes)
        .leftJoin(locations, eq(locations.id, boxes.locationId))
        .leftJoin(items, eq(items.boxId, boxes.id))
        .orderBy(asc(boxes.seriesLetter), asc(boxes.number), asc(items.id));
      const out = [
        ['label', 'box_name', 'location', 'status', 'description', 'item', 'qty', 'note', 'source'],
        ...rows.map((r) => [
          r.label,
          r.boxName,
          r.location,
          r.status,
          r.description,
          r.item,
          r.item ? r.qty : null,
          r.note,
          r.item ? r.source : null,
        ]),
      ];
      res.type('text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="totetrack-inventory.csv"');
      res.send(csv(out));
    }),
  );

  return r;
}
