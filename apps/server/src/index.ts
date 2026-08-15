import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { loadEnv } from './env.js';
import { logger } from './lib/logger.js';
import { ensurePhotoDir } from './services/photos.js';

async function main() {
  const env = loadEnv();
  const handle = createDb(env.DATABASE_URL);

  logger.info('applying migrations');
  await runMigrations(handle.db);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist =
    process.env.WEB_DIST ??
    // dist/index.js → ../public (docker) or ../../web/dist (local build)
    [path.resolve(here, '../public'), path.resolve(here, '../../web/dist')].find((p) =>
      fs.existsSync(path.join(p, 'index.html')),
    );

  const { app, ai, storage } = createApp({ db: handle.db, env, webDist });
  await ensurePhotoDir(storage);

  const recovered = await ai.recoverPending();
  if (recovered) logger.info({ recovered }, 're-queued pending AI jobs');
  if (!ai.available) logger.warn('ANTHROPIC_API_KEY not set — AI analysis disabled');

  const server = http.createServer(app);
  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, publicUrl: env.PUBLIC_URL, photoDir: env.photoDirAbs },
      'totetrack listening',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      handle
        .close()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
