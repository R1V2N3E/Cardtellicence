// What the AI features cost, kept per day on this device. The server reports the token counts
// and a list-price estimate with every answer; this adds them up.
import type { AiUsage } from '../../lib/usage';
import { readList, useStored, write } from '../state';

export type AiKind = 'chat' | 'scan' | 'bulk' | 'shop' | 'condition';
export const KIND_LABEL: Record<AiKind, string> = {
  chat: 'KI-Chat (Antworten)',
  scan: 'Karten-Erkennung',
  bulk: 'Mehrere Karten',
  shop: 'Vitrine',
  condition: 'Zustand & Echtheit',
};

export interface UsageDay {
  date: string; // yyyy-mm-dd
  kinds: Partial<Record<AiKind, { n: number; usd: number; tokens: number }>>;
}

const KEY = 'ct-ai-usage';
const CHAT_KEY = 'ct-ai-chat-cost';

export const readUsage = () => readList<UsageDay>(KEY);
export const useUsage = () => useStored<UsageDay[]>(KEY, readUsage);

/** Add one call (or a chat turn) to today's totals. */
export function recordAiUsage(kind: AiKind, u: AiUsage | null | undefined) {
  if (!u || !Number.isFinite(u.usd)) return;
  const date = new Date().toISOString().slice(0, 10);
  const days = readUsage().filter((d) => d.date >= new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10));
  const day = days.find((d) => d.date === date) ?? { date, kinds: {} };
  const k = day.kinds[kind] ?? { n: 0, usd: 0, tokens: 0 };
  day.kinds[kind] = { n: k.n + 1, usd: k.usd + u.usd, tokens: k.tokens + u.input + u.output + u.cacheRead + u.cacheWrite };
  write(KEY, [...days.filter((d) => d.date !== date), day].sort((a, b) => a.date.localeCompare(b.date)));
  if (kind === 'chat') writeChatCost(readChatCost() + u.usd);
}

// The current conversation's running total (reset with a new conversation).
export function readChatCost(): number {
  try {
    return Number(localStorage.getItem(CHAT_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function writeChatCost(usd: number) {
  try {
    localStorage.setItem(CHAT_KEY, String(usd));
  } catch {
    /* optional */
  }
  window.dispatchEvent(new CustomEvent('ct-storage', { detail: CHAT_KEY }));
}
export const useChatCost = () => useStored<number>(CHAT_KEY, readChatCost);

/** Sum of usd and calls over the days that pass the filter. */
export function sumUsage(days: UsageDay[], from: string, to = '9999') {
  let usd = 0;
  let n = 0;
  const byKind: Partial<Record<AiKind, { n: number; usd: number }>> = {};
  for (const d of days)
    if (d.date >= from && d.date <= to)
      for (const [k, v] of Object.entries(d.kinds) as [AiKind, { n: number; usd: number }][]) {
        usd += v.usd;
        n += v.n;
        byKind[k] = { n: (byKind[k]?.n ?? 0) + v.n, usd: (byKind[k]?.usd ?? 0) + v.usd };
      }
  return { usd, n, byKind };
}
