import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import type { Env } from '../env.js';

export const SETTING_KEYS = {
  pinHash: 'pin_hash',
  sessionGeneration: 'session_generation',
  aiModel: 'ai_model',
  aiAutoAnalyze: 'ai_auto_analyze',
  aiApiKey: 'anthropic_api_key',
  aiSystemPrompt: 'ai_system_prompt',
  defaultLabelTemplate: 'default_label_template',
  publicUrl: 'public_url',
  sessionSecret: 'session_secret',
  tunnelToken: 'cloudflare_tunnel_token',
  scanOpensCamera: 'scan_opens_camera',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export async function getSetting(db: Db, key: SettingKey): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function getSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(db: Db, key: SettingKey, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
}

export async function deleteSetting(db: Db, key: SettingKey): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

// --- effective values (env vs settings precedence) -------------------------

/** Anthropic key: the env var always wins (secret managed by the operator); otherwise the stored setting. */
export async function effectiveApiKey(
  db: Db,
  env: Env,
): Promise<{ key: string | undefined; source: 'env' | 'settings' | 'none' }> {
  if (env.ANTHROPIC_API_KEY) return { key: env.ANTHROPIC_API_KEY, source: 'env' };
  const stored = await getSetting(db, SETTING_KEYS.aiApiKey);
  return stored ? { key: stored, source: 'settings' } : { key: undefined, source: 'none' };
}

/**
 * Public origin for QR codes. Precedence: Settings value → PUBLIC_URL env → the origin of the
 * current request (i.e. whatever address the user is browsing on, e.g. the tunnel hostname).
 */
export async function effectivePublicUrl(
  db: Db,
  env: Env,
  req?: Request,
): Promise<{ url: string; source: 'settings' | 'env' | 'request' | 'default' }> {
  const stored = await getSetting(db, SETTING_KEYS.publicUrl);
  if (stored) return { url: stored.replace(/\/+$/, ''), source: 'settings' };
  if (env.PUBLIC_URL) return { url: env.PUBLIC_URL, source: 'env' };
  const fromReq = req ? requestOrigin(req) : null;
  if (fromReq) return { url: fromReq, source: 'request' };
  return { url: `http://localhost:${env.PORT}`, source: 'default' };
}

/** Origin the client used to reach us (honours X-Forwarded-* via `trust proxy`). */
export function requestOrigin(req: Request): string | null {
  // req.hostname/req.protocol only honour X-Forwarded-* from trusted proxies (`trust proxy`).
  const hostname = req.hostname;
  if (!hostname) return null;
  // req.hostname strips the port; keep it for non-default ports (LAN http://host:3000).
  const rawHost = req.get('host') ?? '';
  const port = rawHost.startsWith(hostname) ? rawHost.slice(hostname.length) : '';
  const forwardedHost = req.get('x-forwarded-host');
  const usingForwarded = Boolean(forwardedHost) && req.hostname !== rawHost.replace(/:\d+$/, '');
  return `${req.protocol}://${hostname}${usingForwarded ? '' : port}`;
}

/** Cloudflare tunnel token: env wins, otherwise the stored setting. */
export async function effectiveTunnelToken(
  db: Db,
  env: Env,
): Promise<{ token: string | undefined; source: 'env' | 'settings' | 'none' }> {
  if (env.CLOUDFLARE_TUNNEL_TOKEN) return { token: env.CLOUDFLARE_TUNNEL_TOKEN, source: 'env' };
  const stored = await getSetting(db, SETTING_KEYS.tunnelToken);
  return stored ? { token: stored, source: 'settings' } : { token: undefined, source: 'none' };
}

/**
 * Session-signing secret. Env value if provided; otherwise a random secret generated on first
 * boot and persisted in settings, so a fresh `docker compose up` needs no configuration.
 */
export async function resolveSessionSecret(db: Db, envSecret: string | undefined): Promise<string> {
  if (envSecret) return envSecret;
  const stored = await getSetting(db, SETTING_KEYS.sessionSecret);
  if (stored) return stored;
  const generated = randomBytes(32).toString('hex');
  await setSetting(db, SETTING_KEYS.sessionSecret, generated);
  return generated;
}
