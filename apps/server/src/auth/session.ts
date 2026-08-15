import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Env } from '../env.js';

export const SESSION_COOKIE = 'tt_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionPayload {
  v: 1;
  iat: number;
  exp: number;
  /** Session generation (random, stored in settings); rotate it to sign out every device. */
  gen: string;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(secret: string, gen: string, now = Date.now()): string {
  const payload: SessionPayload = { v: 1, iat: now, exp: now + SESSION_TTL_MS, gen };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.v !== 1 || typeof payload.exp !== 'number' || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, env: Env, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.sessionCookieSecure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.sessionCookieSecure,
    path: '/',
  });
}

export function readSessionCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[SESSION_COOKIE];
}
