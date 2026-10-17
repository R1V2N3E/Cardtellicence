// What each Claude call costs: token counts from the API response, priced at list prices.
// Calls made while handling one request are collected per request (AsyncLocalStorage), so a
// recognition with several model calls reports one total.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface AiUsage {
  calls: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  searches: number;
  usd: number;
}

// $ per million tokens (list prices). Fast mode costs twice the standard rates.
const PRICES: Record<string, { in: number; out: number; write: number; read: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, write: 5, read: 0.2 },
  'claude-opus-5': { in: 5, out: 25, write: 6.25, read: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, write: 6.25, read: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, write: 2.5, read: 0.2 },
};
const SEARCH_USD = 10 / 1000;

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
  speed?: string | null;
};

export const emptyUsage = (): AiUsage => ({ calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0, usd: 0 });

export function usageOf(model: string, u: UsageLike): AiUsage {
  const p = PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? 'claude-opus-5-5'];
  const f = u.speed === 'fast' ? 2 : 1;
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const usd = (f * (u.input_tokens * p.in + u.output_tokens * p.out + write * p.write + read * p.read)) / 1e6 + searches * SEARCH_USD;
  return { calls: 1, input: u.input_tokens, output: u.output_tokens, cacheWrite: write, cacheRead: read, searches, usd };
}

export const addUsage = (a: AiUsage, b: AiUsage): AiUsage => ({
  calls: a.calls + b.calls,
  input: a.input + b.input,
  output: a.output + b.output,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cacheRead: a.cacheRead + b.cacheRead,
  searches: a.searches + b.searches,
  usd: a.usd + b.usd,
});

const scope = new AsyncLocalStorage<{ total: AiUsage }>();

/** Run fn and collect the usage of every model call inside it. */
export async function withUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: AiUsage }> {
  const box = { total: emptyUsage() };
  const result = await scope.run(box, fn);
  return { result, usage: box.total };
}

/** Called after each model response. */
export function recordUsage(model: string, u: UsageLike) {
  const box = scope.getStore();
  if (box) box.total = addUsage(box.total, usageOf(model, u));
}

/** Usage collected so far in the current request (for streamed handlers). */
export const currentUsage = () => scope.getStore()?.total ?? emptyUsage();
