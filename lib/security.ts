// Access control and abuse protection for the API.
//
// - Paid endpoints (Claude: agent, vision, identify) need the access code. On Vercel they refuse
//   to run without one configured (fail closed), so a missing variable never opens them up.
// - The code is compared in constant time; wrong guesses per IP are throttled.
// - Every route has a per-IP rate limit; the paid ones also a daily cap for the whole app.
//   Counts live in Upstash Redis when it is set up (shared by all instances), else in memory
//   (per instance — weaker, but still a brake).
import { createHash, timingSafeEqual } from 'node:crypto';
import { kvConfigured, kvGet, kvIncr } from './kv.js';

const local = new Map<string, { n: number; until: number }>();

const kvKey = (key: string, windowSec: number) => `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;

/** Current count in the window without counting a hit. */
async function peek(key: string, windowSec: number): Promise<number> {
  if (kvConfigured()) {
    try {
      return Number(await kvGet<number>(kvKey(key, windowSec))) || 0;
    } catch {
      /* fall back to memory */
    }
  }
  const e = local.get(key);
  return e && e.until > Date.now() ? e.n : 0;
}

async function hit(key: string, windowSec: number): Promise<number> {
  if (kvConfigured()) {
    try {
      return await kvIncr(kvKey(key, windowSec), windowSec);
    } catch {
      // KV unreachable: fall back to this instance's memory.
    }
  }
  const now = Date.now();
  const e = local.get(key);
  if (!e || e.until <= now) {
    local.set(key, { n: 1, until: now + windowSec * 1000 });
    if (local.size > 5000) for (const [k, v] of local) if (v.until <= now) local.delete(k);
    return 1;
  }
  return ++e.n;
}

/** The caller's IP as Vercel reports it (Vercel sets these headers; clients can't override them). */
export function clientIp(req: Request): string {
  return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

/** null when allowed, else the 429 response. */
export async function rateLimit(req: Request, bucket: string, limit: number, windowSec: number, perIp = true): Promise<Response | null> {
  const n = await hit(`${bucket}:${perIp ? clientIp(req) : 'all'}`, windowSec);
  if (n <= limit) return null;
  return json(429, { error: perIp ? 'Zu viele Anfragen – bitte kurz warten.' : 'Tageslimit erreicht – morgen geht es weiter.' }, { 'retry-after': String(windowSec) });
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time comparison of the access code (no early exit that leaks how much matched). */
export function codeMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

const onVercel = () => !!process.env.VERCEL;

/**
 * Access check for paid endpoints: null when allowed, else the error response.
 * After 8 wrong codes from one IP within 15 minutes, that IP is locked out for the rest of the window.
 */
export async function requireAccess(req: Request): Promise<Response | null> {
  const code = process.env.APP_ACCESS_CODE?.trim();
  if (!code) return onVercel() ? json(503, { error: 'access_code_not_configured' }) : null;
  const lockKey = `authfail:${clientIp(req)}`;
  const locked = json(429, { error: 'Zu viele Fehlversuche – in 15 Minuten erneut versuchen.' });
  // A locked IP is refused before the code is even compared, so guessing can't go on.
  if ((await peek(lockKey, 15 * 60)) >= 8) return locked;
  if (codeMatches(req.headers.get('x-access-code') ?? '', code)) return null;
  const n = await hit(lockKey, 15 * 60);
  // Slow every wrong guess down a little.
  await new Promise((r) => setTimeout(r, 400));
  if (n >= 8) return locked;
  return json(401, { error: 'access_code' });
}

/** Limits for the paid endpoints: per IP, plus a daily cap for the whole app (env-adjustable). */
export async function paidLimits(req: Request, kind: 'agent' | 'vision' | 'identify'): Promise<Response | null> {
  const perTenMin = { agent: 60, vision: 15, identify: 30 }[kind];
  const perDay = Number(process.env[`AI_DAILY_${kind.toUpperCase()}`]) || { agent: 800, vision: 120, identify: 400 }[kind];
  return (await rateLimit(req, `${kind}:10m`, perTenMin, 600)) ?? (await rateLimit(req, `${kind}:day`, perDay, 86400, false));
}

type Handler = (req: Request) => Response | Promise<Response>;

/** Wrap a public route in a per-IP rate limit. */
export const limited =
  (bucket: string, limit: number, windowSec: number, handler: Handler): Handler =>
  async (req) =>
    (await rateLimit(req, bucket, limit, windowSec)) ?? handler(req);
