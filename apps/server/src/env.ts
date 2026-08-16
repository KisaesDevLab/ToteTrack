import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Load the nearest `.env` (cwd or an ancestor) without overriding real env vars. Skipped in production. */
function loadDotenv(): void {
  if (process.env.NODE_ENV === 'production' || process.env.TOTETRACK_NO_DOTENV) return;
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Treat empty strings (e.g. `${VAR:-}` from compose) as unset. */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

/**
 * Only infrastructure plumbing lives here. Everything a household member would want to change
 * (PIN, AI key/model/prompt, public address, Cloudflare tunnel token, label sheet…) is a Settings-page
 * value stored in the database; the env values below are optional defaults/overrides.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Optional: generated once and stored in the DB when absent. */
  SESSION_SECRET: optionalString.pipe(z.string().min(16).optional()),
  /** Optional: overrides the key stored in Settings. */
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString.transform((v) => v ?? 'claude-sonnet-5'),
  /** Optional: default public origin; Settings overrides; otherwise auto-detected per request. */
  PUBLIC_URL: optionalString,
  /** Optional: overrides the tunnel token stored in Settings. */
  CLOUDFLARE_TUNNEL_TOKEN: optionalString,
  /** Path to the cloudflared binary the app manages (bundled in the Docker image). */
  CLOUDFLARED_BIN: optionalString.transform((v) => v ?? '/usr/local/bin/cloudflared'),
  PHOTO_DIR: optionalString.transform((v) => v ?? './data/photos'),
  LOG_LEVEL: optionalString.transform((v) => v ?? 'info'),
  /** Comma-separated list of allowed CORS origins in dev (Vite). */
  DEV_ORIGIN: optionalString.transform((v) => v ?? 'http://localhost:5173'),
  /** Trust proxy hops (Cloudflare Tunnel → app). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'SESSION_SECRET'> & {
  /** Resolved at boot: env value or the persisted/generated one. */
  SESSION_SECRET: string;
  photoDirAbs: string;
};

let cached: Env | undefined;

export function loadEnv(
  overrides: Partial<Record<keyof z.infer<typeof EnvSchema>, string>> = {},
): Env {
  loadDotenv();
  const raw = { ...process.env, ...overrides };
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  const result: Env = {
    ...env,
    // Placeholder until resolveSessionSecret() runs (index.ts); tests always pass one explicitly.
    SESSION_SECRET: env.SESSION_SECRET ?? '',
    PUBLIC_URL: env.PUBLIC_URL?.replace(/\/+$/, ''),
    photoDirAbs: path.resolve(env.PHOTO_DIR),
  };
  cached = result;
  return result;
}

export function env(): Env {
  return cached ?? loadEnv();
}
