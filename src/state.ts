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
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: state just doesn't persist */
  }
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
