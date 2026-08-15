import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../env.js';
import { unauthorized } from '../lib/errors.js';
import type { PinStore } from './pin.js';
import { readSessionCookie, verifySessionToken } from './session.js';

export interface AuthContext {
  env: Env;
  pins: PinStore;
}

export async function isAuthenticated(req: Request, ctx: AuthContext): Promise<boolean> {
  const payload = verifySessionToken(readSessionCookie(req), ctx.env.SESSION_SECRET);
  if (!payload) return false;
  const gen = await ctx.pins.generation();
  return gen !== null && payload.gen === gen;
}

/** Guards `/api/*` (except health + auth endpoints, mounted before this). */
export function requireAuth(ctx: AuthContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    isAuthenticated(req, ctx)
      .then((ok) => (ok ? next() : next(unauthorized())))
      .catch(next);
  };
}
