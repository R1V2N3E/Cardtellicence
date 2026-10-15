import { useEffect, useState } from 'react';
import type { IdentifyProgress, IdentifyResult } from '../lib/identify';
import type { CardReport, CardSummary, ChartPoint, FxRates, HistoryFile, Opportunity, OpportunityFile, SealedItem } from '../lib/types';
import { readAccessCode } from './state';

/** Current prices for the cards and sealed products of some sets (see /api/live). */
export interface LivePatch {
  items: Record<string, Partial<Opportunity>>;
  sealed: Record<string, Partial<SealedItem>>;
  sets: string[];
  at: string;
}

export interface LivePrice {
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  low: number | null;
  updated: string | null;
  source?: 'cardmarket' | 'japan' | 'cardrush';
  /** Card Rush: shop sell price (JPY), stock, buy price; updated during the day. */
  cr?: { jpy: number; stock: number; buyJpy: number | null; url: string; updatedAt: string } | null;
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  search: (q: string) => getJson<{ results: CardSummary[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.results),
  card: (id: string) => getJson<CardReport>(`/api/card?id=${encodeURIComponent(id)}`),
  snkChart: (id: number, cond: string, range: string) =>
    getJson<{ points: ChartPoint[] }>(`/api/chart?source=snkrdunk&id=${id}&cond=${cond}&range=${range}`).then((r) => r.points),
  sealedChart: (id: number, range: string) =>
    getJson<{ points: ChartPoint[] }>(`/api/chart?source=snkrdunk-sealed&id=${id}&range=${range}`).then((r) => r.points),
  pcChart: (card: string) => getJson<{ ungraded: ChartPoint[]; psa10: ChartPoint[] }>(`/api/chart?source=pricecharting&card=${encodeURIComponent(card)}`),
  // fresh: bypass browser, service-worker and CDN caches (manual refresh).
  opportunities: (fresh = false) =>
    getJson<OpportunityFile>(fresh ? `/data/opportunities.json?t=${Date.now()}` : '/data/opportunities.json', fresh ? { cache: 'no-store' } : undefined),
  fx: (fresh = false) => getJson<FxRates>(fresh ? `/api/fx?t=${Date.now()}` : '/api/fx', fresh ? { cache: 'no-store' } : undefined),
  prices: (ids: string[], fresh = false) =>
    getJson<{ prices: Record<string, LivePrice | null>; fetchedAt: string }>(
      `/api/prices?ids=${ids.map(encodeURIComponent).join(',')}${fresh ? '&fresh=1' : ''}`,
      fresh ? { cache: 'no-store' } : undefined,
    ),
  live: (sets: string[], fresh: boolean) =>
    getJson<LivePatch>(`/api/live?sets=${sets.map(encodeURIComponent).join(',')}${fresh ? '&fresh=1' : ''}`, fresh ? { cache: 'no-store' } : undefined),
  /** Recognise a card; onProgress receives each step as the server finishes it. */
  identify: async (image: string, onProgress?: (e: IdentifyProgress) => void): Promise<IdentifyResult> => {
    const res = await fetch('/api/identify?stream=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-code': readAccessCode() },
      body: JSON.stringify({ image }),
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error ?? `http_${res.status}`, body.error ?? `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      buf += dec.decode(value ?? new Uint8Array(), { stream: !done });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const e = JSON.parse(line) as IdentifyProgress;
        if (e.stage === 'done') return e.result;
        if (e.stage === 'error') throw new ApiError('failed', e.error);
        onProgress?.(e);
      }
      if (done) throw new ApiError('failed', 'Verbindung abgebrochen – bitte erneut versuchen.');
    }
  },
  history: (setId: string) => getJson<HistoryFile>(`/data/history/${encodeURIComponent(setId)}.json`).catch(() => ({}) as HistoryFile),
};

let oppCache: Promise<OpportunityFile> | null = null;
export const loadOpportunities = (fresh = false) => {
  if (fresh || !oppCache) oppCache = api.opportunities(fresh).catch((e) => ((oppCache = null), Promise.reject(e)));
  return oppCache;
};

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (e) => alive && setState({ error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}
