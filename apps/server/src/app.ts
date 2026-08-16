import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { pinoHttp } from 'pino-http';
import { requireAuth } from './auth/middleware.js';
import { PinStore } from './auth/pin.js';
import { authRouter } from './auth/routes.js';
import type { Db } from './db/index.js';
import type { Env } from './env.js';
import { HttpError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { backupRouter } from './routes/backup.js';
import { boxesRouter } from './routes/boxes.js';
import { itemsRouter } from './routes/items.js';
import { labelsRouter } from './routes/labels.js';
import { exportRouter, searchRouter, settingsRouter } from './routes/misc.js';
import { photosRouter } from './routes/photos.js';
import { trashRouter } from './routes/trash.js';
import { seriesRouter } from './routes/series.js';
import { locationsRouter } from './routes/locations.js';
import { AiService } from './services/ai.js';
import { createPhotoStorage, type PhotoStorage } from './services/photos.js';
import { TunnelManager } from './services/tunnel.js';

export const APP_VERSION = process.env.APP_VERSION ?? '0.1.0';

export interface AppDeps {
  db: Db;
  env: Env;
  ai?: AiService;
  tunnel?: TunnelManager;
  storage?: PhotoStorage;
  /** Directory of the built web app to serve (production). */
  webDist?: string;
}

export interface App {
  app: Express;
  ai: AiService;
  tunnel: TunnelManager;
  storage: PhotoStorage;
  pins: PinStore;
}

export function createApp(deps: AppDeps): App {
  const { db, env } = deps;
  const storage = deps.storage ?? createPhotoStorage(env.photoDirAbs);
  const ai =
    deps.ai ??
    new AiService(db, storage, {
      apiKey: env.ANTHROPIC_API_KEY,
      defaultModel: env.ANTHROPIC_MODEL,
    });
  const pins = new PinStore(db);
  const tunnel = deps.tunnel ?? new TunnelManager(db, env);
  const authCtx = { env, pins };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);

  app.use(
    helmet({
      // The SPA is same-origin; images come from /api. Keep CSP conservative but functional.
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          // Helmet's default would force https for every asset/API call — which breaks the app when it
          // is opened over plain http on a LAN address (http://192.168.x.x:3000). Leave the scheme alone.
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/health' },
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  // Dev-only CORS for the Vite dev server (different origin). Production is same-origin.
  if (env.NODE_ENV === 'development') {
    const allowed = new Set(env.DEV_ORIGIN.split(',').map((s) => s.trim()));
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') return res.status(204).end();
      next();
    });
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // --- public API ---------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION });
  });
  app.use('/api/auth', authRouter(authCtx));

  // --- protected API ------------------------------------------------------
  const api = express.Router();
  api.use(requireAuth(authCtx));
  api.use('/series', seriesRouter(db));
  api.use('/locations', locationsRouter(db));
  api.use('/boxes', boxesRouter({ db, storage, ai }));
  api.use('/items', itemsRouter(db));
  api.use('/photos', photosRouter(db, storage, ai));
  api.use('/search', searchRouter(db));
  api.use('/labels', labelsRouter(db, env));
  api.use('/export', exportRouter(db));
  api.use('/settings', settingsRouter(db, env, ai, tunnel, APP_VERSION));
  api.use('/trash', trashRouter(db, storage));
  api.use('/backup', backupRouter(db, storage, pins, ai, APP_VERSION));
  app.use('/api', api);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route' } });
  });

  // --- static SPA (production) -------------------------------------------
  const webDist = deps.webDist ?? process.env.WEB_DIST;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(
      express.static(webDist, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // --- errors -------------------------------------------------------------
  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: { code: 'upload_error', message: err.message } });
      return;
    }
    if (
      err &&
      typeof err === 'object' &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
      return;
    }
    logger.error({ err, url: req.url }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  };
  app.use(errorHandler);

  return { app, ai, tunnel, storage, pins };
}
