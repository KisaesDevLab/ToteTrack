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

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  PHOTO_DIR: z.string().default('./data/photos'),
  LOG_LEVEL: z.string().default('info'),
  /** Comma-separated list of allowed CORS origins in dev (Vite). */
  DEV_ORIGIN: z.string().default('http://localhost:5173'),
  /** Trust proxy hops (Cloudflare Tunnel → app). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

export type Env = z.infer<typeof EnvSchema> & { photoDirAbs: string; sessionCookieSecure: boolean };

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
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');
  const result: Env = {
    ...env,
    PUBLIC_URL: publicUrl,
    photoDirAbs: path.resolve(env.PHOTO_DIR),
    // Secure cookies only when served over https (behind the tunnel). Local dev is http.
    sessionCookieSecure: env.NODE_ENV === 'production' && publicUrl.startsWith('https://'),
  };
  cached = result;
  return result;
}

export function env(): Env {
  return cached ?? loadEnv();
}
