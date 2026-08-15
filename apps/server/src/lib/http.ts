import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors.js';

/** Wraps an async route handler so rejections reach the error middleware (Express 4). */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}

export function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest('Invalid request body', r.error.flatten());
  return r.data;
}

export function parseQuery<T extends ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const r = schema.safeParse(query);
  if (!r.success) throw badRequest('Invalid query parameters', r.error.flatten());
  return r.data;
}

export function idParam(value: string | undefined, name = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}
