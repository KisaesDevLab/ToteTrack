import { ChangePinInput, LoginInput, SetupInput } from '@totetrack/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { conflict, unauthorized } from '../lib/errors.js';
import { asyncHandler, parseBody } from '../lib/http.js';
import type { AuthContext } from './middleware.js';
import { isAuthenticated, requireAuth } from './middleware.js';
import { clearSessionCookie, createSessionToken, setSessionCookie } from './session.js';

export function authRouter(ctx: AuthContext): Router {
  const r = Router();
  const { env, pins } = ctx;

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    // Cloudflare Tunnel sets CF-Connecting-IP; fall back to the proxied/express ip.
    keyGenerator: (req) =>
      (req.headers['cf-connecting-ip'] as string | undefined) ?? req.ip ?? 'unknown',
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many attempts. Try again in 15 minutes.' },
      });
    },
  });

  r.get(
    '/status',
    asyncHandler(async (req, res) => {
      const setupRequired = await pins.isSetupRequired();
      const authenticated = !setupRequired && (await isAuthenticated(req, ctx));
      res.json({ setupRequired, authenticated });
    }),
  );

  // First-run: only allowed while no PIN exists.
  r.post(
    '/setup',
    asyncHandler(async (req, res) => {
      const { pin } = parseBody(SetupInput, req.body);
      if (!(await pins.isSetupRequired())) throw conflict('PIN is already configured');
      const gen = await pins.setPin(pin);
      setSessionCookie(res, env, createSessionToken(env.SESSION_SECRET, gen));
      res.status(201).json({ ok: true });
    }),
  );

  r.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const { pin } = parseBody(LoginInput, req.body);
      if (await pins.isSetupRequired()) throw conflict('Setup required');
      if (!(await pins.verify(pin))) throw unauthorized('Incorrect PIN');
      const gen = (await pins.generation())!;
      setSessionCookie(res, env, createSessionToken(env.SESSION_SECRET, gen));
      res.json({ ok: true });
    }),
  );

  r.post('/logout', (_req, res) => {
    clearSessionCookie(res, env);
    res.json({ ok: true });
  });

  r.post(
    '/change-pin',
    requireAuth(ctx),
    asyncHandler(async (req, res) => {
      const { currentPin, newPin } = parseBody(ChangePinInput, req.body);
      if (!(await pins.verify(currentPin))) throw unauthorized('Current PIN is incorrect');
      const gen = await pins.setPin(newPin);
      // Existing sessions stay valid (generation unchanged); refresh this device's cookie expiry.
      setSessionCookie(res, env, createSessionToken(env.SESSION_SECRET, gen));
      res.json({ ok: true });
    }),
  );

  return r;
}
