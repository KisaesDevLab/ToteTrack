import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';

export const SETTING_KEYS = {
  pinHash: 'pin_hash',
  sessionGeneration: 'session_generation',
  aiModel: 'ai_model',
  aiAutoAnalyze: 'ai_auto_analyze',
  defaultLabelTemplate: 'default_label_template',
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
