// Tiny key-value store on Upstash Redis (REST API), for the few things the server must remember:
// push subscriptions and the push signing keys. Added in Vercel under Storage → Upstash Redis,
// which sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN).

const url = () => process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
const token = () => process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

export const kvConfigured = () => !!(url() && token());

async function command<T>(args: (string | number)[]): Promise<T> {
  const res = await fetch(url(), {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || body.error) throw new Error(`KV: ${body.error ?? res.status}`);
  return body.result as T;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const raw = await command<string | null>(['GET', key]);
  return raw == null ? null : (JSON.parse(raw) as T);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await command(['SET', key, JSON.stringify(value)]);
}

/** Count a hit in a fixed window; returns the count in the current window. */
export async function kvIncr(key: string, windowSec: number): Promise<number> {
  const n = await command<number>(['INCR', key]);
  if (n === 1) await command(['EXPIRE', key, windowSec]);
  return n;
}
