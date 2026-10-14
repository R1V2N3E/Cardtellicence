import { useEffect, useState } from 'react';
import type { IdentifyResult } from '../lib/identify';
import type { CardReport, CardSummary, ChartPoint, HistoryFile, OpportunityFile } from '../lib/types';
import { readAccessCode } from './state';

export interface LivePrice {
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  low: number | null;
  updated: string | null;
  source?: 'cardmarket' | 'japan';
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
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
  pcChart: (card: string) => getJson<{ ungraded: ChartPoint[]; psa10: ChartPoint[] }>(`/api/chart?source=pricecharting&card=${encodeURIComponent(card)}`),
  opportunities: () => getJson<OpportunityFile>('/data/opportunities.json'),
  prices: (ids: string[]) =>
    getJson<{ prices: Record<string, LivePrice | null>; fetchedAt: string }>(`/api/prices?ids=${ids.map(encodeURIComponent).join(',')}`),
  identify: async (image: string): Promise<IdentifyResult> => {
    const res = await fetch('/api/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-code': readAccessCode() },
      body: JSON.stringify({ image }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? `http_${res.status}`, body.error ?? `HTTP ${res.status}`);
    return body;
  },
  history: (setId: string) => getJson<HistoryFile>(`/data/history/${encodeURIComponent(setId)}.json`).catch(() => ({}) as HistoryFile),
};

let oppCache: Promise<OpportunityFile> | null = null;
export const loadOpportunities = (fresh = false) => {
  if (fresh || !oppCache) oppCache = api.opportunities().catch((e) => ((oppCache = null), Promise.reject(e)));
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
