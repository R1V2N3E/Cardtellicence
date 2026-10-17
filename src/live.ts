// Live prices laid over the daily scan, shared by every page (Deals, Markt, set pages, the
// assistant): one refresh re-reads Card Rush and Cardmarket for all sets, and every page shows
// the result. Pages refresh on their own when the last live read is older than a few minutes.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Opportunity, OpportunityFile, SealedItem } from '../lib/types';
import { api, loadOpportunities } from './api';

export interface LiveState {
  items: Record<string, Partial<Opportunity>>;
  sealed: Record<string, Partial<SealedItem>>;
  at: string | null; // when the last refresh finished (or its newest part)
  busy: boolean;
  done: number;
  total: number;
  failed: number;
}

let state: LiveState = { items: {}, sealed: {}, at: null, busy: false, done: 0, total: 0, failed: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<LiveState> | ((s: LiveState) => Partial<LiveState>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const STALE_MS = 10 * 60_000;
export const liveAge = () => (state.at ? Date.now() - Date.parse(state.at) : Infinity);

let running: Promise<LiveState> | null = null;

/** Re-read all sets (a few per request, three in parallel). Concurrent calls share one run. */
export function refreshLive(): Promise<LiveState> {
  if (running) return running;
  running = (async () => {
    const scan = await loadOpportunities().catch(() => null);
    if (!scan) return state;
    const sets = scan.sets.map((s) => s.id);
    const queue: string[][] = [];
    for (let i = 0; i < sets.length; i += 6) queue.push(sets.slice(i, i + 6));
    set({ busy: true, done: 0, total: sets.length, failed: 0 });
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const patch = await api.live(c, true).catch(() => null);
        set((s) => ({
          items: { ...s.items, ...patch?.items },
          sealed: { ...s.sealed, ...patch?.sealed },
          at: patch?.at ?? s.at,
          done: s.done + c.length,
          failed: s.failed + (patch ? 0 : c.length),
        }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    set({ busy: false });
    return state;
  })().finally(() => (running = null));
  return running;
}

/** Refresh once when the live prices are missing or older than STALE_MS. */
export function refreshIfStale() {
  if (!state.busy && liveAge() > STALE_MS) void refreshLive();
}

export const liveState = () => state;
export const useLive = () => useSyncExternalStore(subscribe, () => state);

/** The scan file with the live prices laid over it. */
export function withLive(scan: OpportunityFile, live: LiveState = state): OpportunityFile {
  if (!live.at) return scan;
  return {
    ...scan,
    items: scan.items.map((o) => (live.items[o.id] ? { ...o, ...live.items[o.id] } : o)),
    sealed: scan.sealed?.map((x) => (live.sealed[x.id] ? { ...x, ...live.sealed[x.id] } : x)),
  };
}

/** Scan + live prices for a page; refreshes by itself when stale (autoRefresh). */
export function useLiveScan(scan: OpportunityFile | null | undefined, autoRefresh = true) {
  const live = useLive();
  useEffect(() => {
    if (autoRefresh && scan) refreshIfStale();
  }, [autoRefresh, !!scan]);
  const data = useMemo(() => (scan ? withLive(scan, live) : scan), [scan, live.at, live.done]);
  return { data, live };
}

/** "Live vor 2 Min." / "aktualisiert 12/77 Sets…" / "Scan von heute 05:47" */
export function liveLabel(live: LiveState, scanAt: string, ago: (iso: string) => string) {
  if (live.busy) return `Live-Preise ${live.done}/${live.total} Sets …`;
  if (live.at) return `Live ${ago(live.at)}`;
  return `Scan ${ago(scanAt)}`;
}
