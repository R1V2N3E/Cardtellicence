import { mirror, requestPersistence } from './storage';
// Client-side state: settings and watchlist live in this device's localStorage.
import { useCallback, useEffect, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function readList<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
  } catch {
    /* private mode or full: the IndexedDB copy below still keeps it */
  }
  mirror(key, raw);
  window.dispatchEvent(new CustomEvent('ct-storage', { detail: key }));
}

function useStored<T>(key: string, load: () => T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(load);
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent).detail === key && setValue(load());
    window.addEventListener('ct-storage', on);
    return () => window.removeEventListener('ct-storage', on);
  }, [key]);
  return [value, useCallback((v: T) => write(key, v), [key])];
}

export type BuySource = 'cheapest' | 'yuyutei' | 'snkrdunk' | 'mercari';
export type SellRef = 'trend' | 'avg30' | 'avg7' | 'low';

export interface Settings {
  buySource: BuySource;
  sellRef: SellRef;
  minTrend: number;
  includeSoldOut: boolean;
  showJpy: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  buySource: 'cheapest',
  sellRef: 'trend',
  minTrend: 10,
  includeSoldOut: false,
  showJpy: true,
};

export const useSettings = () => useStored<Settings>('ct-settings', () => read('ct-settings', DEFAULT_SETTINGS));

export interface WatchItem {
  id: string;
  nameJa: string;
  nameEn: string | null;
  setId: string;
  number: string;
  image: string | null;
  fallbackImage?: string | null;
  addedAt: string;
  // Snapshot when last viewed, so the list is useful without refetching.
  last?: { at: string; buyJpy: number | null; buySource: string | null; sellEur: number | null; marginEur: number | null };
}

export function useWatchlist() {
  const [list, setList] = useStored<WatchItem[]>('ct-watch', () => readList<WatchItem>('ct-watch'));
  const has = (id: string) => list.some((w) => w.id === id);
  const toggle = (item: Omit<WatchItem, 'addedAt'>) =>
    setList(has(item.id) ? list.filter((w) => w.id !== item.id) : [{ ...item, addedAt: new Date().toISOString() }, ...list]);
  const update = (id: string, last: WatchItem['last']) => {
    const cur = readList<WatchItem>('ct-watch');
    if (cur.some((w) => w.id === id)) write('ct-watch', cur.map((w) => (w.id === id ? { ...w, last } : w)));
  };
  return { list, has, toggle, update };
}

// ---- Collection (portfolio) ----

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'PSA10' | 'PSA9';
export const CONDITIONS: [Condition, string][] = [
  ['NM', 'Near Mint (NM)'],
  ['LP', 'Light Played (LP)'],
  ['MP', 'Moderately Played (MP)'],
  ['HP', 'Heavily Played (HP)'],
  ['PSA10', 'PSA 10'],
  ['PSA9', 'PSA 9'],
];

export interface CollectionItem {
  uid: string;
  cardId: string;
  nameJa: string;
  nameEn: string | null;
  setId: string;
  setName: string;
  number: string;
  rarity: string | null;
  image: string | null;
  photo?: string | null; // full image URL (sealed products, deck cards)
  kind?: 'card' | 'sealed';
  qty: number;
  condition: Condition;
  /** What was paid per copy, in the currency it was paid in. */
  cost?: { amount: number; currency: 'JPY' | 'EUR' } | null;
  addedAt: string;
}

export function useCollection() {
  const [items, setItems] = useStored<CollectionItem[]>('ct-collection', () => readList<CollectionItem>('ct-collection'));
  const add = (item: Omit<CollectionItem, 'uid' | 'addedAt'>) => {
    void requestPersistence();
    const cur = readList<CollectionItem>('ct-collection');
    // Same card, condition and cost → just raise the quantity.
    const same = cur.find(
      (c) => c.cardId === item.cardId && c.condition === item.condition && JSON.stringify(c.cost ?? null) === JSON.stringify(item.cost ?? null),
    );
    if (same) return setItems(cur.map((c) => (c === same ? { ...c, qty: c.qty + item.qty } : c)));
    setItems([{ ...item, uid: crypto.randomUUID(), addedAt: new Date().toISOString() }, ...cur]);
  };
  const update = (uid: string, patch: Partial<CollectionItem>) =>
    setItems(readList<CollectionItem>('ct-collection').map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
  const remove = (uid: string) => setItems(readList<CollectionItem>('ct-collection').filter((c) => c.uid !== uid));
  const replaceAll = (next: CollectionItem[]) => setItems(next);
  return { items, add, update, remove, replaceAll };
}

/** Daily portfolio totals for the change figure and the value chart: [yyyy-mm-dd, EUR]. */
export function recordPortfolioValue(value: number) {
  const today = new Date().toISOString().slice(0, 10);
  const hist = readList<[string, number]>('ct-portfolio-history').filter(([d]) => d !== today);
  hist.push([today, Math.round(value * 100) / 100]);
  write('ct-portfolio-history', hist.slice(-730));
}
export const readPortfolioHistory = () => readList<[string, number]>('ct-portfolio-history');

/**
 * Intraday values for the 1-day chart: [epoch ms, EUR]. A point is kept whenever the value
 * changes, and at most every 10 minutes while it doesn't; 30 days are kept.
 */
export function recordPortfolioTick(value: number) {
  const now = Date.now();
  const v = Math.round(value * 100) / 100;
  const ticks = readList<[number, number]>('ct-portfolio-ticks').filter(([t]) => t > now - 30 * 86400_000);
  const last = ticks[ticks.length - 1];
  if (last && last[1] === v && now - last[0] < 10 * 60_000) return;
  ticks.push([now, v]);
  write('ct-portfolio-ticks', ticks);
}
export const readPortfolioTicks = () => readList<[number, number]>('ct-portfolio-ticks');

export function readAccessCode(): string {
  try {
    return localStorage.getItem('ct-access-code') ?? '';
  } catch {
    return '';
  }
}
export function writeAccessCode(code: string) {
  try {
    localStorage.setItem('ct-access-code', code);
  } catch {
    /* ignore */
  }
  mirror('ct-access-code', code);
}
