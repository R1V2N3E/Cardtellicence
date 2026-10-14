// Shared fetch helpers: browser-like headers, timeouts and a small in-memory TTL cache.
// The cache lives per server instance (serverless warm starts) or per scanner run.

export const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

type Entry = { expires: number; value: Promise<unknown> };
const cache = new Map<string, Entry>();
const MAX_ENTRIES = 500;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: now + ttlMs, value });
  // Failed loads must not be cached.
  value.catch(() => cache.delete(key));
  if (cache.size > MAX_ENTRIES) {
    for (const [k, e] of cache) if (e.expires <= now) cache.delete(k);
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  return value;
}

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${new URL(url).host}`);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function request(url: string, init: RequestInit = {}, timeoutMs = 12000, retries = 2): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((e) => {
      if (attempt >= retries) throw e;
      return null;
    });
    if (res?.ok) return res;
    if (res && (!RETRYABLE.has(res.status) || attempt >= retries)) throw new HttpError(res.status, url);
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
}

export const getText = (url: string, init?: RequestInit) => request(url, init).then((r) => r.text());
export const getJson = <T = any>(url: string, init?: RequestInit) =>
  request(url, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } }).then(
    (r) => r.json() as Promise<T>,
  );

/** Run fn over items with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
