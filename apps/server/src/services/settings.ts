import { eq, sql } from 'drizzle-orm';
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

/** Public origin for QR codes: a Settings value overrides the PUBLIC_URL env default. */
export async function effectivePublicUrl(db: Db, env: Env): Promise<string> {
  const stored = await getSetting(db, SETTING_KEYS.publicUrl);
  return (stored ?? env.PUBLIC_URL).replace(/\/+$/, '');
}
