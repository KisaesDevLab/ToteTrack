import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const BOX_STATUSES = ['open', 'sealed'] as const;
export const BoxStatus = z.enum(BOX_STATUSES);
export type BoxStatus = z.infer<typeof BoxStatus>;

export const AI_STATUSES = ['none', 'pending', 'done', 'error'] as const;
export const AiStatus = z.enum(AI_STATUSES);
export type AiStatus = z.infer<typeof AiStatus>;

export const ITEM_SOURCES = ['ai', 'manual'] as const;
export const ItemSource = z.enum(ITEM_SOURCES);
export type ItemSource = z.infer<typeof ItemSource>;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const Id = z.number().int().positive();
export const SeriesLetter = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]$/, 'Series letter must be a single letter A-Z');

/** Canonical label form, e.g. `A-014`. */
export const LABEL_ID_REGEX = /^([A-Za-z])-?(\d{1,6})$/;
export const LABEL_NUMBER_PAD = 3;

export function formatLabelId(letter: string, number: number): string {
  return `${letter.toUpperCase()}-${String(number).padStart(LABEL_NUMBER_PAD, '0')}`;
}

/** Normalises user input like `a14`, `A-14`, `a-014` to `A-014`. Returns null if unparseable. */
export function normalizeLabelId(input: string): string | null {
  const m = LABEL_ID_REGEX.exec(input.trim());
  if (!m) return null;
  const letter = m[1]!;
  const number = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(number)) return null;
  return formatLabelId(letter, number);
}

// ---------------------------------------------------------------------------
// Entities (API responses)
// ---------------------------------------------------------------------------

export const Series = z.object({
  id: Id,
  letter: z.string(),
  description: z.string().nullable(),
  nextNumber: z.number().int(),
  boxCount: z.number().int().optional(),
  /** Pre-printed labels in this series that no box has claimed yet. */
  unclaimedLabels: z.number().int().optional(),
  createdAt: z.string(),
});
export type Series = z.infer<typeof Series>;

export const Location = z.object({
  id: Id,
  name: z.string(),
  sortOrder: z.number().int(),
  boxCount: z.number().int().optional(),
  createdAt: z.string(),
});
export type Location = z.infer<typeof Location>;

export const Photo = z.object({
  id: Id,
  boxId: Id,
  sortOrder: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  aiStatus: AiStatus,
  aiError: z.string().nullable(),
  createdAt: z.string(),
  /** Session-protected URLs, served by the API. */
  originalUrl: z.string(),
  thumbUrl: z.string(),
});
export type Photo = z.infer<typeof Photo>;

export const Item = z.object({
  id: Id,
  boxId: Id,
  name: z.string(),
  qty: z.number().int(),
  note: z.string().nullable(),
  source: ItemSource,
  photoId: Id.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Item = z.infer<typeof Item>;

export const BoxSummary = z.object({
  id: Id,
  seriesId: Id,
  seriesLetter: z.string(),
  number: z.number().int(),
  labelId: z.string(),
  name: z.string().nullable(),
  locationId: Id.nullable(),
  locationName: z.string().nullable(),
  status: BoxStatus,
  aiStatus: AiStatus,
  aiError: z.string().nullable(),
  aiDescription: z.string().nullable(),
  photoCount: z.number().int(),
  itemCount: z.number().int(),
  thumbUrl: z.string().nullable(),
  printedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BoxSummary = z.infer<typeof BoxSummary>;

export const BoxDetail = BoxSummary.extend({
  photos: z.array(Photo),
  items: z.array(Item),
});
export type BoxDetail = z.infer<typeof BoxDetail>;

export const SearchResult = BoxSummary.extend({
  rank: z.number(),
  matchedFields: z.array(z.string()),
  headline: z.string().nullable(),
});
export type SearchResult = z.infer<typeof SearchResult>;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const SeriesCreateInput = z.object({
  letter: SeriesLetter,
  description: z.string().trim().max(200).optional().nullable(),
});
export type SeriesCreateInput = z.infer<typeof SeriesCreateInput>;

export const SeriesUpdateInput = z.object({
  description: z.string().trim().max(200).nullable().optional(),
  nextNumber: z.number().int().min(1).max(999999).optional(),
});
export type SeriesUpdateInput = z.infer<typeof SeriesUpdateInput>;

export const LocationCreateInput = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().optional(),
});
export type LocationCreateInput = z.infer<typeof LocationCreateInput>;

export const LocationUpdateInput = LocationCreateInput.partial();
export type LocationUpdateInput = z.infer<typeof LocationUpdateInput>;

export const LocationReorderInput = z.object({ ids: z.array(Id).min(1) });

export const BoxCreateInput = z.object({
  seriesId: Id,
  /** Optional explicit number (e.g. re-creating a scanned label). Defaults to the series' next number. */
  number: z.number().int().min(1).max(999999).optional(),
  name: z.string().trim().max(200).optional().nullable(),
  locationId: Id.optional().nullable(),
  status: BoxStatus.optional(),
});
export type BoxCreateInput = z.infer<typeof BoxCreateInput>;

export const BoxUpdateInput = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  locationId: Id.nullable().optional(),
  status: BoxStatus.optional(),
  aiDescription: z.string().max(20000).nullable().optional(),
});
export type BoxUpdateInput = z.infer<typeof BoxUpdateInput>;

export const BoxListQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  seriesId: z.coerce.number().int().positive().optional(),
  status: BoxStatus.optional(),
  unprinted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['label', 'recent', 'name']).optional(),
});
export type BoxListQuery = z.infer<typeof BoxListQuery>;

export const ItemCreateInput = z.object({
  name: z.string().trim().min(1).max(300),
  qty: z.number().int().min(0).max(1000000).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type ItemCreateInput = z.infer<typeof ItemCreateInput>;

export const ItemUpdateInput = ItemCreateInput.partial();
export type ItemUpdateInput = z.infer<typeof ItemUpdateInput>;

export const PhotoReorderInput = z.object({ ids: z.array(Id).min(1) });

export const SearchQuery = z.object({
  q: z.string().trim().max(200).optional().default(''),
  locationId: z.coerce.number().int().positive().optional(),
  status: BoxStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const LabelPdfInput = z.object({
  boxIds: z.array(Id).min(1).max(500),
  templateId: z.string().optional(),
  startOffset: z.number().int().min(0).max(100).optional().default(0),
  includeName: z.boolean().optional().default(true),
  markPrinted: z.boolean().optional().default(true),
});
export type LabelPdfInput = z.infer<typeof LabelPdfInput>;

/** Print a batch of labels for numbers that don't have boxes yet. */
export const PreprintInput = z.object({
  seriesId: Id,
  count: z.number().int().min(1).max(200),
  templateId: z.string().optional(),
  startOffset: z.number().int().min(0).max(100).optional().default(0),
});
export type PreprintInput = z.infer<typeof PreprintInput>;

export const PreprintedLabel = z.object({
  id: Id,
  seriesId: Id,
  seriesLetter: z.string(),
  number: z.number().int(),
  labelId: z.string(),
  printedAt: z.string(),
  claimedBoxId: Id.nullable(),
  claimedAt: z.string().nullable(),
});
export type PreprintedLabel = z.infer<typeof PreprintedLabel>;

/** What a scanned label resolves to. */
export const LabelLookup = z.object({
  labelId: z.string(),
  box: BoxSummary.nullable(),
  preprinted: PreprintedLabel.nullable(),
  /** The series exists, so the label can be created with this exact number. */
  seriesId: Id.nullable(),
});
export type LabelLookup = z.infer<typeof LabelLookup>;

export const LabelTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  perSheet: z.number().int(),
  columns: z.number().int(),
  rows: z.number().int(),
});
export type LabelTemplate = z.infer<typeof LabelTemplate>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const Pin = z
  .string()
  .min(4, 'PIN must be at least 4 characters')
  .max(64, 'PIN must be at most 64 characters');

export const LoginInput = z.object({ pin: Pin });
export type LoginInput = z.infer<typeof LoginInput>;

export const SetupInput = z.object({ pin: Pin });

export const ChangePinInput = z.object({ currentPin: Pin, newPin: Pin });
export type ChangePinInput = z.infer<typeof ChangePinInput>;

export const AuthStatus = z.object({
  setupRequired: z.boolean(),
  authenticated: z.boolean(),
});
export type AuthStatus = z.infer<typeof AuthStatus>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const AppSettings = z.object({
  aiModel: z.string(),
  aiAutoAnalyze: z.boolean(),
  aiAvailable: z.boolean(),
  /** Where the active Anthropic key comes from. `env` always wins over `settings`. */
  aiKeySource: z.enum(['env', 'settings', 'none']),
  /** Last 4 characters of the active key, for display only. */
  aiKeyHint: z.string().nullable(),
  aiSystemPrompt: z.string(),
  aiSystemPromptDefault: z.string(),
  aiSystemPromptCustom: z.boolean(),
  defaultLabelTemplate: z.string(),
  /** Arriving at a box via a QR scan opens the Scan/Rescan panel automatically. */
  scanOpensCamera: z.boolean(),
  /** Effective public origin used in QR codes. */
  publicUrl: z.string(),
  /** settings → PUBLIC_URL env → auto-detected from the request → localhost fallback */
  publicUrlSource: z.enum(['settings', 'env', 'request', 'default']),
  publicUrlEnv: z.string().nullable(),
  publicUrlCustom: z.boolean(),
  tunnel: z.object({
    tokenSource: z.enum(['env', 'settings', 'none']),
    binaryAvailable: z.boolean(),
    state: z.enum(['disabled', 'unavailable', 'starting', 'connected', 'error']),
    connectedSince: z.string().nullable(),
    lastError: z.string().nullable(),
    log: z.array(z.string()),
    restarts: z.number().int(),
  }),
  version: z.string(),
});
export type AppSettings = z.infer<typeof AppSettings>;
export type TunnelStatus = AppSettings['tunnel'];

export const PublicUrl = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^https?:\/\/[^\s/?#]+(?::\d+)?\/?$/,
    'Enter an origin like https://totes.example.com (no path)',
  );

export const SettingsUpdateInput = z.object({
  aiModel: z.string().trim().min(1).max(100).optional(),
  aiAutoAnalyze: z.boolean().optional(),
  defaultLabelTemplate: z.string().optional(),
  /** New key, or null to remove the stored key. Never returned by the API. */
  anthropicApiKey: z.string().trim().min(10).max(500).nullable().optional(),
  /** Custom system prompt, or null to reset to the built-in default. */
  aiSystemPrompt: z.string().max(20000).nullable().optional(),
  /** Custom public origin, or null to fall back to the PUBLIC_URL env value / auto-detection. */
  publicUrl: PublicUrl.nullable().optional(),
  /** Cloudflare tunnel connector token, or null to remove it (stops the tunnel). */
  cloudflareTunnelToken: z.string().trim().min(20).max(2000).nullable().optional(),
  scanOpensCamera: z.boolean().optional(),
});
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateInput>;

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const AiItem = z.object({
  name: z.string().trim().min(1).max(300),
  qty: z.number().int().min(1).max(100000).optional().default(1),
  note: z.string().trim().max(2000).optional().nullable(),
});
export type AiItem = z.infer<typeof AiItem>;

export const AiAnalysis = z.object({
  description: z.string().max(20000),
  items: z.array(AiItem),
});
export type AiAnalysis = z.infer<typeof AiAnalysis>;

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
