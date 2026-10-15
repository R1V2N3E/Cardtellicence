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

export type BuySource = 'cardrush' | 'cheapest' | 'yuyutei' | 'snkrdunk' | 'mercari';
/** What the portfolio is valued at: Card Rush (Japan's reference price) or Cardmarket. */
export type Valuation = 'cardrush' | 'cardrushBuy' | 'cardmarket';
/** Every cost of a trade can be switched off on its own. */
export type CostItem = 'proxy' | 'ship' | 'duty' | 'vat' | 'sellFee' | 'revShip' | 'revTax';
export type SellRef = 'trend' | 'avg30' | 'avg7' | 'low';
export type SellChannel = 'cardmarket' | 'ebay' | 'ebayPro' | 'kleinanzeigen';

export interface Settings {
  buySource: BuySource;
  sellRef: SellRef;
  minTrend: number;
  includeSoldOut: boolean;
  showJpy: boolean;
  valuation: Valuation;
  /** Net margins: costs of importing (proxy fee, shipping, duty, import VAT) and of selling. */
  net: boolean;
  proxyPct: number;
  shipEur: number; // per card, Japan → Germany
  shipSealedEur: number; // per box/pack
  dutyPct: number;
  vatPct: number;
  sellChannel: SellChannel;
  revShipEur: number; // per card, Germany → Japan (reverse deals)
  revTaxPct: number; // Japanese import consumption tax (mail over ¥10,000)
  revBuyRef: SellRef; // which Cardmarket price a Germany → Japan buy is made at
  costOn: Record<CostItem, boolean>;
  /** Grading calculator */
  gradingEur: number; // PSA fee + shipping per card
  psa10Pct: number; // expected chance of a PSA 10
  /** Set once Card Rush became the default; older saved settings are moved over once. */
  cardrushDefaults?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  buySource: 'cardrush',
  sellRef: 'trend',
  minTrend: 10,
  includeSoldOut: false,
  showJpy: true,
  valuation: 'cardrush',
  net: true,
  proxyPct: 5,
  shipEur: 3,
  shipSealedEur: 8,
  dutyPct: 0,
  vatPct: 19,
  sellChannel: 'cardmarket',
  revShipEur: 4,
  revTaxPct: 10,
  revBuyRef: 'trend',
  costOn: { proxy: true, ship: true, duty: true, vat: true, sellFee: true, revShip: true, revTax: false },
  gradingEur: 40,
  psa10Pct: 40,
  cardrushDefaults: true,
};

function loadSettings(): Settings {
  const s = read('ct-settings', DEFAULT_SETTINGS);
  s.costOn = { ...DEFAULT_SETTINGS.costOn, ...s.costOn };
  // Look at what is stored, not the merged defaults (which already carry the flag).
  const stored = read<Partial<Settings>>('ct-settings', {});
  return stored.cardrushDefaults ? s : { ...s, buySource: 'cardrush', valuation: 'cardrush', cardrushDefaults: true };
}

export const useSettings = () => useStored<Settings>('ct-settings', loadSettings);
export const readSettings = loadSettings;

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

export const readWatchlist = () => readList<WatchItem>('ct-watch');

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

// Values are kept per valuation basis, so switching between Card Rush and Cardmarket never
// draws a fake jump into the chart.
const SUFFIX: Record<Valuation, string> = { cardmarket: '', cardrush: '-cr', cardrushBuy: '-crbuy' };
const historyKey = (v: Valuation) => `ct-portfolio-history${SUFFIX[v]}`;
const ticksKey = (v: Valuation) => `ct-portfolio-ticks${SUFFIX[v]}`;

/** Daily portfolio totals for the change figure and the value chart: [yyyy-mm-dd, EUR]. */
export function recordPortfolioValue(value: number, v: Valuation) {
  const today = new Date().toISOString().slice(0, 10);
  const hist = readList<[string, number]>(historyKey(v)).filter(([d]) => d !== today);
  hist.push([today, Math.round(value * 100) / 100]);
  write(historyKey(v), hist.slice(-730));
}
export const readPortfolioHistory = (v: Valuation) => readList<[string, number]>(historyKey(v));

/**
 * Intraday values for the 1-day chart: [epoch ms, EUR]. A point is kept whenever the value
 * changes, and at most every 10 minutes while it doesn't; 30 days are kept.
 */
export function recordPortfolioTick(value: number, valuation: Valuation) {
  const now = Date.now();
  const v = Math.round(value * 100) / 100;
  const ticks = readList<[number, number]>(ticksKey(valuation)).filter(([t]) => t > now - 30 * 86400_000);
  const last = ticks[ticks.length - 1];
  if (last && last[1] === v && now - last[0] < 10 * 60_000) return;
  ticks.push([now, v]);
  write(ticksKey(valuation), ticks);
}
export const readPortfolioTicks = (v: Valuation) => readList<[number, number]>(ticksKey(v));

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
