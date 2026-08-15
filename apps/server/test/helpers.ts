import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { createApp, type App } from '../src/app.js';
import { createDb, type DbHandle } from '../src/db/index.js';
import { loadEnv, type Env } from '../src/env.js';
import { AiService, type AiServiceOptions } from '../src/services/ai.js';
import { createPhotoStorage } from '../src/services/photos.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tote:tote@localhost:5442/totetrack_test';

export const TEST_PIN = '2468';

export interface TestContext {
  handle: DbHandle;
  env: Env;
  app: App;
  /** supertest agent with a cookie jar (logged in after `login()`). */
  agent: request.Agent;
  photoDir: string;
  cleanup: () => Promise<void>;
}

export async function truncateAll(handle: DbHandle): Promise<void> {
  await handle.db.execute(
    sql`TRUNCATE TABLE items, photos, boxes, locations, series, settings RESTART IDENTITY CASCADE`,
  );
}

export async function createTestContext(
  opts: { ai?: Partial<AiServiceOptions> } = {},
): Promise<TestContext> {
  process.env.TOTETRACK_NO_DOTENV = '1';
  const photoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'totetrack-test-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    PHOTO_DIR: photoDir,
    PUBLIC_URL: 'https://totes.example.com',
    ANTHROPIC_API_KEY: '',
    LOG_LEVEL: 'silent',
  });
  const handle = createDb(TEST_DATABASE_URL);
  await truncateAll(handle);
  const storage = createPhotoStorage(photoDir);
  const ai = new AiService(handle.db, storage, {
    apiKey: undefined,
    defaultModel: 'test-model',
    ...opts.ai,
  });
  const app = createApp({ db: handle.db, env, ai, storage });
  const agent = request.agent(app.app);
  return {
    handle,
    env,
    app,
    agent,
    photoDir,
    cleanup: async () => {
      await handle.close();
      await fs.rm(photoDir, { recursive: true, force: true });
    },
  };
}

export async function setupAndLogin(ctx: TestContext, pin = TEST_PIN): Promise<void> {
  const status = await ctx.agent.get('/api/auth/status');
  if (status.body.setupRequired) {
    await ctx.agent.post('/api/auth/setup').send({ pin }).expect(201);
  } else {
    await ctx.agent.post('/api/auth/login').send({ pin }).expect(200);
  }
}

export async function seedBasics(ctx: TestContext) {
  const a = (
    await ctx.agent.post('/api/series').send({ letter: 'A', description: 'General' }).expect(201)
  ).body;
  const b = (await ctx.agent.post('/api/series').send({ letter: 'B' }).expect(201)).body;
  const garage = (await ctx.agent.post('/api/locations').send({ name: 'Garage' }).expect(201)).body;
  const attic = (await ctx.agent.post('/api/locations').send({ name: 'Attic' }).expect(201)).body;
  return { a, b, garage, attic };
}

export async function makeJpeg(
  width = 640,
  height = 480,
  color = { r: 180, g: 90, b: 30 },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}
