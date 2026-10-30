/**
 * Request handling shared by every function: CORS allowlist, method and size
 * limits, JSON parsing, security headers, request ids and safe error output.
 */
import { env } from './env.ts';
import { errorBody, GENERIC_MESSAGE, HttpError } from './errors.ts';

export interface HandlerOptions {
  /** Allowed methods besides OPTIONS. Default: POST. */
  methods?: string[];
  /** Maximum request body in bytes. Default 64 KiB. */
  maxBytes?: number;
  /** Body format. 'json' (default), 'form' (payment gateways), 'auto' (by content-type) or 'none'. */
  body?: 'json' | 'form' | 'auto' | 'none';
  /** Server-to-server endpoints (webhooks, scheduler) skip browser CORS. */
  cors?: boolean;
}

export interface RequestContext {
  req: Request;
  requestId: string;
  url: URL;
  /** Parsed JSON object, or form fields as a plain object. */
  body: Record<string, unknown>;
}

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const ALLOWED_REQUEST_HEADERS = 'authorization, x-client-info, apikey, content-type, idempotency-key, x-request-id';

function corsHeaders(req: Request, methods: string[]): Record<string, string> {
  const origin = req.headers.get('origin');
  const allowed = env.allowedOrigins;
  const permitted = origin && (allowed.includes(origin) || (allowed.includes('*') && env.appEnv !== 'production'));
  if (!permitted) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin!,
    'access-control-allow-methods': [...methods, 'OPTIONS'].join(', '),
    'access-control-allow-headers': ALLOWED_REQUEST_HEADERS,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data ?? null), { status, headers: { ...BASE_HEADERS, ...extra } });
}

export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

async function readBody(req: Request, kind: HandlerOptions['body'], maxBytes: number): Promise<Record<string, unknown>> {
  if (kind === 'none' || req.method === 'GET') return {};
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'VALIDATION', 'The request is too large.');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, 'VALIDATION', 'The request is too large.');
  if (!text) return {};
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  if (kind === 'form' || (kind === 'auto' && !contentType.includes('application/json'))) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, 'VALIDATION', 'Send the request as JSON.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'VALIDATION', 'The request body is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'VALIDATION', 'The request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Removes anything secret-looking from a log line: URL query strings (gateway
 * URLs carry store passwords), JWTs, bearer tokens and key=value secrets.
 */
export function redact(message: string): string {
  return message
    .replace(/(https?:\/\/[^\s?)'"]+)\?[^\s)'"]*/gi, '$1?[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[jwt]')
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:passw(?:or)?d|passwd|secret|token|api[_-]?key|app[_-]?key|private[_-]?key|credential)s?["']?\s*[:=]\s*["']?)[^\s&,;"']+/gi, '$1[redacted]');
}

/** Logs without secrets: no headers, no bodies, no tokens; messages are redacted. */
export function logError(requestId: string, where: string, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  console.error(JSON.stringify({ level: 'error', requestId, where, message: redact(message).slice(0, 500) }));
}

export function handler(
  options: HandlerOptions,
  fn: (ctx: RequestContext) => Promise<Response | unknown>,
): (req: Request) => Promise<Response> {
  const methods = options.methods ?? ['POST'];
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const useCors = options.cors !== false;

  return async (req: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const cors = useCors ? corsHeaders(req, methods) : {};
    const withMeta = (res: Response) => {
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      res.headers.set('x-request-id', requestId);
      return res;
    };

    if (req.method === 'OPTIONS') {
      return withMeta(new Response(null, { status: 204 }));
    }
    try {
      if (!methods.includes(req.method)) {
        throw new HttpError(405, 'VALIDATION', 'This method is not allowed.');
      }
      const body = await readBody(req, options.body ?? 'json', maxBytes);
      const result = await fn({ req, requestId, url: new URL(req.url), body });
      return withMeta(result instanceof Response ? result : json(result));
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status >= 500) logError(requestId, 'handler', e);
        return withMeta(json(errorBody(e), e.status));
      }
      logError(requestId, 'handler', e);
      return withMeta(json(errorBody(new HttpError(500, 'UNKNOWN', GENERIC_MESSAGE.UNKNOWN)), 500));
    }
  };
}
