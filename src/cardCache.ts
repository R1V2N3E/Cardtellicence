// Fast card pages: reports are cached (memory + sessionStorage), prefetched when a card is
// touched, and shown in stages — what the list already knew, then the quick "core" answer
// (card + Cardmarket), then the full report with all Japanese sources.
import { useEffect, useState } from 'react';
import type { CardReport, CardSummary, CardmarketPrices, FxRates } from '../lib/types';

const FRESH_MS = 10 * 60_000; // reuse without refetching
const KEEP_MS = 6 * 3600_000; // show instantly, refresh in background
const STORE_KEY = 'ct-card-cache';
const MAX_ENTRIES = 40;

type Entry = { report: CardReport; at: number };
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<CardReport>>();

try {
  const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]') as [string, Entry][];
  for (const [id, e] of saved) if (Date.now() - e.at < KEEP_MS) memory.set(id, e);
} catch {
  /* storage unavailable */
}

function persist() {
  try {
    const entries = [...memory.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
    sessionStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch {
    /* quota or private mode: memory cache still works */
  }
}

async function fetchReport(id: string, part?: 'core'): Promise<CardReport> {
  const res = await fetch(`/api/card?id=${encodeURIComponent(id)}${part ? `&part=${part}` : ''}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as CardReport;
}

/** Start loading a card's full report (no-op if cached recently or already loading). */
export function prefetchCard(id: string): Promise<CardReport> {
  const hit = memory.get(id);
  if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.report);
  let p = inflight.get(id);
  if (!p) {
    p = fetchReport(id).then((report) => {
      memory.set(id, { report, at: Date.now() });
      persist();
      return report;
    });
    p.finally(() => inflight.delete(id)).catch(() => {});
    inflight.set(id, p);
  }
  return p;
}

/** What a list already knows about a card, shown before anything is fetched. */
export interface CardPreview {
  card: CardSummary;
  image?: string | null; // best known picture when TCGdex has none
  cardmarket?: Partial<CardmarketPrices> | null;
  fx?: FxRates | null;
}

const PENDING = { ok: false as const, error: '', pending: true };

function fromPreview(p: CardPreview): CardReport {
  const cm = p.cardmarket?.trend != null;
  return {
    card: { illustrator: null, releaseDate: null, dexId: [], ...p.card, externalImage: p.card.externalImage ?? p.image ?? null },
    fx: p.fx ?? { date: '', jpyToEur: 0, usdToEur: 0, source: '' },
    links: {},
    cardmarket: cm
      ? { ok: true, url: '', idProduct: null, trend: null, low: null, avg: null, avg1: null, avg7: null, avg30: null, updated: null, ...p.cardmarket }
      : PENDING,
    cardrush: PENDING,
    yuyutei: PENDING,
    snkrdunk: PENDING,
    mercari: PENDING,
    pricecharting: PENDING,
    fetchedAt: '',
    partial: true,
  };
}

export function useCardReport(id: string, preview?: CardPreview | null) {
  const cached = memory.get(id);
  const [report, setReport] = useState<CardReport | null>(cached?.report ?? (preview ? fromPreview(preview) : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const hit = memory.get(id);
    setError(null);
    setReport(hit?.report ?? (preview ? fromPreview(preview) : null));
    if (hit && Date.now() - hit.at < FRESH_MS) return;

    let full = false;
    // The quick core answer fills the top of the page while the full report is on its way.
    if (!hit) {
      fetchReport(id, 'core')
        .then((core) => {
          if (alive && !full) setReport((prev) => (prev && !prev.partial ? prev : { ...core, card: { ...core.card, externalImage: core.card.externalImage ?? prev?.card.externalImage ?? null } }));
        })
        .catch(() => {});
    }
    prefetchCard(id).then(
      (r) => {
        full = true;
        if (alive) setReport(r);
      },
      (e) => alive && !hit && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  return { report, error };
}
