import { SearchQuery, SettingsUpdateInput, type AppSettings } from '@totetrack/shared';
import { asc, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import type { Db } from '../db/index.js';
import { boxes, items, locations } from '../db/schema.js';
import type { Env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { asyncHandler, parseBody, parseQuery } from '../lib/http.js';
import { DEFAULT_SYSTEM_PROMPT, type AiService } from '../services/ai.js';
import type { TunnelManager } from '../services/tunnel.js';
import { boxSummaryColumns } from '../services/boxes.js';
import { DEFAULT_LABEL_TEMPLATE, LABEL_TEMPLATES } from '../services/labels.js';
import { searchBoxes } from '../services/search.js';
import {
  deleteSetting,
  effectiveApiKey,
  effectivePublicUrl,
  getSettings,
  SETTING_KEYS,
  setSetting,
} from '../services/settings.js';

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

export function settingsRouter(
  db: Db,
  env: Env,
  ai: AiService,
  tunnel: TunnelManager,
  version: string,
): Router {
  const r = Router();

  const read = async (req: Request): Promise<AppSettings> => {
    const s = await getSettings(db);
    const key = await effectiveApiKey(db, env);
    const customPrompt = s[SETTING_KEYS.aiSystemPrompt]?.trim()
      ? s[SETTING_KEYS.aiSystemPrompt]!
      : null;
    const customUrl = s[SETTING_KEYS.publicUrl] ?? null;
    const pub = await effectivePublicUrl(db, env, req);
    return {
      aiModel: s[SETTING_KEYS.aiModel] ?? env.ANTHROPIC_MODEL,
      aiAutoAnalyze: (s[SETTING_KEYS.aiAutoAnalyze] ?? 'true') === 'true',
      aiAvailable: await ai.isAvailable(),
      aiKeySource: key.source,
      aiKeyHint: key.key ? `…${key.key.slice(-4)}` : null,
      aiSystemPrompt: customPrompt ?? DEFAULT_SYSTEM_PROMPT,
      aiSystemPromptDefault: DEFAULT_SYSTEM_PROMPT,
      aiSystemPromptCustom: customPrompt !== null,
      defaultLabelTemplate: s[SETTING_KEYS.defaultLabelTemplate] ?? DEFAULT_LABEL_TEMPLATE,
      publicUrl: pub.url,
      publicUrlSource: pub.source,
      publicUrlEnv: env.PUBLIC_URL ?? null,
      publicUrlCustom: customUrl !== null,
      tunnel: tunnel.status(),
      version,
    };
  };

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await read(req));
    }),
  );

  r.post(
    '/tunnel/restart',
    asyncHandler(async (req, res) => {
      await tunnel.restart();
      res.json(await read(req));
    }),
  );

  r.patch(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseBody(SettingsUpdateInput, req.body);
      if (input.aiModel !== undefined) await setSetting(db, SETTING_KEYS.aiModel, input.aiModel);
      if (input.aiAutoAnalyze !== undefined)
        await setSetting(db, SETTING_KEYS.aiAutoAnalyze, input.aiAutoAnalyze ? 'true' : 'false');
      if (input.anthropicApiKey !== undefined) {
        if (input.anthropicApiKey === null) await deleteSetting(db, SETTING_KEYS.aiApiKey);
        else await setSetting(db, SETTING_KEYS.aiApiKey, input.anthropicApiKey);
      }
      if (input.aiSystemPrompt !== undefined) {
        const v = input.aiSystemPrompt?.trim();
        if (!v || v === DEFAULT_SYSTEM_PROMPT.trim())
          await deleteSetting(db, SETTING_KEYS.aiSystemPrompt);
        else await setSetting(db, SETTING_KEYS.aiSystemPrompt, v);
      }
      if (input.publicUrl !== undefined) {
        if (input.publicUrl === null) await deleteSetting(db, SETTING_KEYS.publicUrl);
        else await setSetting(db, SETTING_KEYS.publicUrl, input.publicUrl.replace(/\/+$/, ''));
      }
      if (input.defaultLabelTemplate !== undefined) {
        if (!LABEL_TEMPLATES[input.defaultLabelTemplate])
          throw badRequest('Unknown label template');
        await setSetting(db, SETTING_KEYS.defaultLabelTemplate, input.defaultLabelTemplate);
      }
      if (input.cloudflareTunnelToken !== undefined) {
        if (input.cloudflareTunnelToken === null) await deleteSetting(db, SETTING_KEYS.tunnelToken);
        else await setSetting(db, SETTING_KEYS.tunnelToken, input.cloudflareTunnelToken);
        await tunnel.apply();
      }
      res.json(await read(req));
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
