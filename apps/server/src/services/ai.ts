import Anthropic from '@anthropic-ai/sdk';
import { AiAnalysis } from '@totetrack/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { boxes, items, photos } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { readForVision, type PhotoStorage } from './photos.js';
import { refreshBoxSearchVector } from './search-vector.js';
import { getSetting, SETTING_KEYS } from './settings.js';

const SYSTEM_PROMPT = `You catalog the contents of household storage totes from photos so the owner can find things later.
Look carefully at everything visible and list each distinct item or group of items.

Respond with JSON only — no prose, no code fences — using exactly this shape:
{"description": string, "items": [{"name": string, "qty": number, "note": string}]}

Rules:
- "description": 1–3 sentences summarising what the tote holds (categories, notable objects, condition). Plain text.
- "items": one entry per distinct item or group. "name" is short and searchable (e.g. "Christmas lights", "blue winter coat", "AA batteries").
- "qty": estimated count of that item; use 1 when unclear. Integer.
- "note": optional detail useful for finding it later (brand, color, size, packaging). Use "" if none.
- Group many identical small items (e.g. "assorted screws") rather than listing each.
- Do not invent items you cannot see. Ignore the tote itself and the background.`;

export interface AiJob {
  kind: 'photo' | 'box';
  id: number;
}

export interface AiServiceOptions {
  apiKey: string | undefined;
  defaultModel: string;
  /** Test hook: overrides the API call. */
  analyzeOverride?: (images: Buffer[], model: string) => Promise<string>;
}

export interface AiRunResult {
  analysis: AiAnalysis;
  raw: string;
  parseFailed: boolean;
}

/** Strips code fences and extracts the outermost JSON object; falls back to description-only. */
export function parseAnalysis(raw: string): { analysis: AiAnalysis; parseFailed: boolean } {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = text.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const validated = AiAnalysis.safeParse(coerceAnalysis(parsed));
      if (validated.success) return { analysis: validated.data, parseFailed: false };
    } catch {
      /* fall through */
    }
  }
  return {
    analysis: { description: text.slice(0, 20000), items: [] },
    parseFailed: true,
  };
}

/** Tolerate common model deviations (qty as string, note null, items missing). */
function coerceAnalysis(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? o.items : [];
  const outItems = rawItems
    .filter((i) => i && typeof i === 'object')
    .map((i) => {
      const it = i as Record<string, unknown>;
      let qty = 1;
      if (typeof it.qty === 'number' && Number.isFinite(it.qty))
        qty = Math.max(1, Math.round(it.qty));
      else if (typeof it.qty === 'string') {
        const n = Number.parseInt(it.qty, 10);
        if (Number.isFinite(n) && n > 0) qty = n;
      }
      const note = typeof it.note === 'string' && it.note.trim() ? it.note.trim() : null;
      return { name: String(it.name ?? '').trim(), qty, note };
    })
    .filter((i) => i.name.length > 0);
  return {
    description: typeof o.description === 'string' ? o.description : String(o.description ?? ''),
    items: outItems,
  };
}

export class AiService {
  private client: Anthropic | undefined;
  private queue: AiJob[] = [];
  private running = false;
  private inFlight = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly storage: PhotoStorage,
    private readonly opts: AiServiceOptions,
  ) {
    if (opts.apiKey)
      this.client = new Anthropic({ apiKey: opts.apiKey, timeout: 180_000, maxRetries: 2 });
  }

  get available(): boolean {
    return Boolean(this.client) || Boolean(this.opts.analyzeOverride);
  }

  async model(): Promise<string> {
    return (await getSetting(this.db, SETTING_KEYS.aiModel)) ?? this.opts.defaultModel;
  }

  async autoAnalyzeEnabled(): Promise<boolean> {
    if (!this.available) return false;
    const v = await getSetting(this.db, SETTING_KEYS.aiAutoAnalyze);
    return v === null ? true : v === 'true';
  }

  /** Called after upload; no-op when AI is unavailable or auto-analyze is disabled. */
  async maybeAutoAnalyzePhoto(photoId: number): Promise<boolean> {
    if (!(await this.autoAnalyzeEnabled())) return false;
    await this.enqueuePhoto(photoId);
    return true;
  }

  async enqueuePhoto(photoId: number): Promise<void> {
    if (!this.available) return;
    const [p] = await this.db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
    if (!p) return;
    await this.db
      .update(photos)
      .set({ aiStatus: 'pending', aiError: null })
      .where(eq(photos.id, photoId));
    await this.db
      .update(boxes)
      .set({ aiStatus: 'pending', aiError: null })
      .where(eq(boxes.id, p.boxId));
    this.push({ kind: 'photo', id: photoId });
  }

  async enqueueBox(boxId: number): Promise<void> {
    if (!this.available) return;
    await this.db
      .update(boxes)
      .set({ aiStatus: 'pending', aiError: null })
      .where(eq(boxes.id, boxId));
    this.push({ kind: 'box', id: boxId });
  }

  /** On boot: re-queue anything left pending by a previous process. */
  async recoverPending(): Promise<number> {
    if (!this.available) return 0;
    const pendingPhotos = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(eq(photos.aiStatus, 'pending'))
      .orderBy(asc(photos.id));
    for (const p of pendingPhotos) this.push({ kind: 'photo', id: p.id });
    const pendingBoxes = await this.db
      .select({ id: boxes.id })
      .from(boxes)
      .where(
        and(
          eq(boxes.aiStatus, 'pending'),
          sql`NOT EXISTS (SELECT 1 FROM photos p WHERE p.box_id = ${boxes.id} AND p.ai_status = 'pending')`,
        ),
      );
    for (const b of pendingBoxes) this.push({ kind: 'box', id: b.id });
    return pendingPhotos.length + pendingBoxes.length;
  }

  /** Resolves when the queue drains (used by tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 25));
  }

  private push(job: AiJob): void {
    const key = `${job.kind}:${job.id}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    this.queue.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        try {
          if (job.kind === 'photo') await this.runPhoto(job.id);
          else await this.runBox(job.id);
        } catch (err) {
          logger.error({ err, job }, 'ai job failed unexpectedly');
        } finally {
          this.inFlight.delete(`${job.kind}:${job.id}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // --- API call ------------------------------------------------------------

  private async analyze(images: Buffer[], model: string): Promise<string> {
    if (this.opts.analyzeOverride) return this.opts.analyzeOverride(images, model);
    if (!this.client) throw new Error('AI is not configured (ANTHROPIC_API_KEY unset)');

    const content: Anthropic.MessageParam['content'] = [
      ...images.map((buf): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
      })),
      {
        type: 'text',
        text:
          images.length > 1
            ? `These ${images.length} photos are all of the same storage tote. Catalog its full contents as one combined JSON result.`
            : 'Catalog the contents of this storage tote as JSON.',
      },
    ];

    const response = await this.client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('The model declined to analyze this image');
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (!text.trim()) throw new Error('Empty response from model');
    return text;
  }

  // --- jobs ----------------------------------------------------------------

  private async runPhoto(photoId: number): Promise<void> {
    const [p] = await this.db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
    if (!p) return; // deleted meanwhile
    try {
      const model = await this.model();
      const image = await readForVision(this.storage, p.originalPath);
      const raw = await this.analyze([image], model);
      const { analysis, parseFailed } = parseAnalysis(raw);
      await this.db.transaction(async (tx) => {
        // Replace this photo's previous AI items; keep manual items and other photos' items.
        await tx.delete(items).where(and(eq(items.photoId, photoId), eq(items.source, 'ai')));
        if (analysis.items.length) {
          await tx.insert(items).values(
            analysis.items.map((it) => ({
              boxId: p.boxId,
              name: it.name,
              qty: it.qty ?? 1,
              note: it.note ?? null,
              source: 'ai' as const,
              photoId,
            })),
          );
        }
        await tx
          .update(photos)
          .set({
            aiStatus: 'done',
            aiError: parseFailed
              ? 'Model response was not valid JSON; saved as description only'
              : null,
            aiDescription: analysis.description || null,
          })
          .where(eq(photos.id, photoId));
        // Box description = concatenated per-photo summaries.
        const summaries = await tx
          .select({ d: photos.aiDescription })
          .from(photos)
          .where(eq(photos.boxId, p.boxId))
          .orderBy(asc(photos.sortOrder), asc(photos.id));
        const combined = summaries
          .map((s) => s.d?.trim())
          .filter((s): s is string => Boolean(s))
          .join('\n\n');
        await this.finishBox(tx, p.boxId, combined || null, parseFailed);
      });
      logger.info({ photoId, items: analysis.items.length }, 'ai photo analysis done');
    } catch (err) {
      const message = errMessage(err);
      logger.warn({ err, photoId }, 'ai photo analysis failed');
      await this.db
        .update(photos)
        .set({ aiStatus: 'error', aiError: message })
        .where(eq(photos.id, photoId));
      await this.failBox(p.boxId, message);
    }
  }

  private async runBox(boxId: number): Promise<void> {
    const [b] = await this.db.select().from(boxes).where(eq(boxes.id, boxId)).limit(1);
    if (!b) return;
    try {
      const photoRows = await this.db
        .select()
        .from(photos)
        .where(eq(photos.boxId, boxId))
        .orderBy(asc(photos.sortOrder), asc(photos.id));
      if (!photoRows.length) throw new Error('Box has no photos to analyze');
      const model = await this.model();
      const images = await Promise.all(
        photoRows.slice(0, 20).map((p) => readForVision(this.storage, p.originalPath)),
      );
      const raw = await this.analyze(images, model);
      const { analysis, parseFailed } = parseAnalysis(raw);
      await this.db.transaction(async (tx) => {
        // Box-level run replaces ALL AI-sourced rows for the box.
        await tx.delete(items).where(and(eq(items.boxId, boxId), eq(items.source, 'ai')));
        if (analysis.items.length) {
          await tx.insert(items).values(
            analysis.items.map((it) => ({
              boxId,
              name: it.name,
              qty: it.qty ?? 1,
              note: it.note ?? null,
              source: 'ai' as const,
              photoId: null,
            })),
          );
        }
        await tx
          .update(photos)
          .set({ aiStatus: 'done', aiError: null })
          .where(eq(photos.boxId, boxId));
        await this.finishBox(tx, boxId, analysis.description || null, parseFailed);
      });
      logger.info({ boxId, items: analysis.items.length }, 'ai box analysis done');
    } catch (err) {
      const message = errMessage(err);
      logger.warn({ err, boxId }, 'ai box analysis failed');
      await this.failBox(boxId, message);
    }
  }

  private async finishBox(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    boxId: number,
    description: string | null,
    parseFailed = false,
  ) {
    const stillPending = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(photos)
      .where(and(eq(photos.boxId, boxId), eq(photos.aiStatus, 'pending')));
    const pendingLeft = Number(stillPending[0]?.n ?? 0) > 0;
    await tx
      .update(boxes)
      .set({
        aiDescription: description,
        aiStatus: pendingLeft ? 'pending' : 'done',
        aiError: parseFailed
          ? 'Model response was not valid JSON; saved as description only'
          : null,
      })
      .where(eq(boxes.id, boxId));
    await refreshBoxSearchVector(tx, boxId);
  }

  private async failBox(boxId: number, message: string) {
    await this.db
      .update(boxes)
      .set({ aiStatus: 'error', aiError: message })
      .where(eq(boxes.id, boxId));
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError)
    return `${err.status ?? ''} ${err.message}`.trim().slice(0, 500);
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}
