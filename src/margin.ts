import type { CardReport, Opportunity } from '../lib/types';
import type { BuySource, SellRef, Settings } from './state';

export interface BuyOption {
  source: Exclude<BuySource, 'cheapest'>;
  label: string;
  jpy: number;
  note?: string;
  url?: string;
}

export interface Margin {
  buy: BuyOption | null;
  buyEur: number | null;
  sellEur: number | null;
  marginEur: number | null;
  roi: number | null;
}

export const BUY_LABEL: Record<BuySource, string> = {
  cheapest: 'Günstigster',
  yuyutei: 'Yuyu-tei',
  snkrdunk: 'SNKRDUNK',
  mercari: 'Mercari',
};
export const SELL_LABEL: Record<SellRef, string> = {
  trend: 'Trend',
  avg30: '30-Tage-Ø',
  avg7: '7-Tage-Ø',
  low: 'Niedrigster',
};

const cheapest = (options: BuyOption[]) => options.reduce<BuyOption | null>((best, o) => (!best || o.jpy < best.jpy ? o : best), null);

/** The chosen source, or — when that source has no price for this item — the cheapest available one. */
export function pickBuy(options: BuyOption[], source: BuySource, fallback = false): BuyOption | null {
  if (source === 'cheapest') return cheapest(options);
  return options.find((o) => o.source === source) ?? (fallback ? cheapest(options) : null);
}

export function computeMargin(buy: BuyOption | null, sellEur: number | null, jpyToEur: number): Margin {
  const buyEur = buy ? buy.jpy * jpyToEur : null;
  const marginEur = buyEur != null && sellEur != null ? sellEur - buyEur : null;
  return { buy, buyEur, sellEur, marginEur, roi: marginEur != null && buyEur ? marginEur / buyEur : null };
}

/** "as of 12 Oct" when a carried-over shop price is older than a day. */
function staleNote(asOf: string | null | undefined): string | undefined {
  if (!asOf || Date.now() - Date.parse(asOf) < 36 * 3600_000) return undefined;
  return `Stand ${new Date(asOf).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`;
}

export function opportunityMargin(o: Opportunity, s: Settings, jpyToEur: number): Margin {
  const options: BuyOption[] = [];
  if (o.yytJpy && (s.includeSoldOut || o.yytStock !== 0))
    options.push({ source: 'yuyutei', label: 'Yuyu-tei', jpy: o.yytJpy, note: o.yytStock === 0 ? 'ausverkauft' : staleNote(o.yytAsOf) });
  if (o.snkAskJpy) options.push({ source: 'snkrdunk', label: 'SNKRDUNK', jpy: o.snkAskJpy });
  const sell = s.sellRef === 'trend' ? o.cmTrend : s.sellRef === 'avg30' ? o.cmAvg30 : s.sellRef === 'low' ? o.cmLow : o.cmTrend;
  // The daily scan has no Mercari prices: fall back to the cheapest scanned source instead of hiding the card.
  return computeMargin(pickBuy(options, s.buySource, true), sell, jpyToEur);
}

export function reportBuyOptions(r: CardReport, includeSoldOut: boolean): BuyOption[] {
  const out: BuyOption[] = [];
  if (r.yuyutei.ok && (includeSoldOut || r.yuyutei.stock !== 0))
    out.push({
      source: 'yuyutei',
      label: 'Yuyu-tei',
      jpy: r.yuyutei.priceJpy,
      note: r.yuyutei.stock === 0 ? 'ausverkauft' : r.yuyutei.stock != null ? `${r.yuyutei.stock} auf Lager` : undefined,
      url: r.yuyutei.url,
    });
  if (r.snkrdunk.ok && r.snkrdunk.lowestAskJpy)
    out.push({
      source: 'snkrdunk',
      label: 'SNKRDUNK',
      jpy: r.snkrdunk.lowestAskJpy,
      note: r.snkrdunk.listingCount ? `${r.snkrdunk.listingCount} Angebote` : undefined,
      url: r.snkrdunk.url,
    });
  if (r.mercari.ok && r.mercari.activeLowestJpy)
    out.push({ source: 'mercari', label: 'Mercari', jpy: r.mercari.activeLowestJpy, note: 'günstigstes Angebot', url: r.mercari.url });
  return out;
}

export function reportSell(r: CardReport, ref: SellRef): number | null {
  if (!r.cardmarket.ok) return null;
  return r.cardmarket[ref] ?? r.cardmarket.trend;
}
