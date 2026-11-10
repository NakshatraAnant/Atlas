import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';

// RFC 9457 problem details (Blueprint §7.1). Entitlement failures → 402 with an upgrade hint;
// quota exhaustion and rate limits → 429; never leak internals in `detail`.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly extra: Record<string, unknown> = {},
    public readonly type = 'about:blank',
  ) {
    super(detail ?? title);
  }
}

export const badRequest = (detail: string, extra: Record<string, unknown> = {}) => new ApiError(400, 'Bad request', detail, extra, 'https://atlas.example/problems/validation');
export const unauthorized = (detail = 'Sign in to continue.') => new ApiError(401, 'Unauthorised', detail, {}, 'https://atlas.example/problems/unauthenticated');
export const forbidden = (detail = 'You do not have access to this resource.') => new ApiError(403, 'Forbidden', detail, {}, 'https://atlas.example/problems/forbidden');
export const notFound = (detail = 'Not found.') => new ApiError(404, 'Not found', detail, {}, 'https://atlas.example/problems/not-found');
export const conflict = (detail: string) => new ApiError(409, 'Conflict', detail, {}, 'https://atlas.example/problems/conflict');
export const unavailable = (detail: string, extra: Record<string, unknown> = {}) => new ApiError(503, 'Service unavailable', detail, extra, 'https://atlas.example/problems/unavailable');
export const paymentRequired = (detail: string, extra: Record<string, unknown>) => new ApiError(402, 'Upgrade required', detail, extra, 'https://atlas.example/problems/entitlement');
export const tooMany = (detail: string, extra: Record<string, unknown> = {}) => new ApiError(429, 'Limit reached', detail, extra, 'https://atlas.example/problems/limit');

export function sendProblem(reply: FastifyReply, req: FastifyRequest, err: ApiError): FastifyReply {
  return reply
    .status(err.status)
    .type('application/problem+json')
    .send({ type: err.type, title: err.title, status: err.status, detail: err.detail, instance: req.url.split('?')[0], correlation_id: req.id, ...err.extra });
}

export const MAX_REPORTED_ISSUES = 20;
export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      // At most 20 issues are returned: enough to fix a request, and the error body stays small.
      const issues = err.issues.slice(0, MAX_REPORTED_ISSUES).map((i) => ({ path: i.path.join('.'), message: i.message }));
      throw badRequest('The request is not valid.', { errors: issues, ...(err.issues.length > MAX_REPORTED_ISSUES ? { errors_truncated: err.issues.length } : {}) });
    }
    throw err;
  }
}

/** Cursor pagination helper: cursor is an opaque base64url of the last sort key. */
export function encodeCursor(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}
export function decodeCursor<T>(c: string | undefined): T | undefined {
  if (!c) return undefined;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T;
  } catch {
    throw badRequest('Invalid cursor.');
  }
}
