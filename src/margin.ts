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
  cheapest: 'Cheapest',
  yuyutei: 'Yuyu-tei',
  snkrdunk: 'SNKRDUNK',
  mercari: 'Mercari',
};
export const SELL_LABEL: Record<SellRef, string> = {
  trend: 'Trend',
  avg30: '30-day avg',
  avg7: '7-day avg',
  low: 'Lowest',
};

export function pickBuy(options: BuyOption[], source: BuySource): BuyOption | null {
  if (source !== 'cheapest') return options.find((o) => o.source === source) ?? null;
  return options.reduce<BuyOption | null>((best, o) => (!best || o.jpy < best.jpy ? o : best), null);
}

export function computeMargin(buy: BuyOption | null, sellEur: number | null, jpyToEur: number): Margin {
  const buyEur = buy ? buy.jpy * jpyToEur : null;
  const marginEur = buyEur != null && sellEur != null ? sellEur - buyEur : null;
  return { buy, buyEur, sellEur, marginEur, roi: marginEur != null && buyEur ? marginEur / buyEur : null };
}

export function opportunityMargin(o: Opportunity, s: Settings, jpyToEur: number): Margin {
  const options: BuyOption[] = [];
  if (o.yytJpy && (s.includeSoldOut || o.yytStock !== 0))
    options.push({ source: 'yuyutei', label: 'Yuyu-tei', jpy: o.yytJpy, note: o.yytStock === 0 ? 'sold out' : undefined });
  if (o.snkAskJpy) options.push({ source: 'snkrdunk', label: 'SNKRDUNK', jpy: o.snkAskJpy });
  const sell = s.sellRef === 'trend' ? o.cmTrend : s.sellRef === 'avg30' ? o.cmAvg30 : s.sellRef === 'low' ? o.cmLow : o.cmTrend;
  return computeMargin(pickBuy(options, s.buySource), sell, jpyToEur);
}

export function reportBuyOptions(r: CardReport, includeSoldOut: boolean): BuyOption[] {
  const out: BuyOption[] = [];
  if (r.yuyutei.ok && (includeSoldOut || r.yuyutei.stock !== 0))
    out.push({
      source: 'yuyutei',
      label: 'Yuyu-tei',
      jpy: r.yuyutei.priceJpy,
      note: r.yuyutei.stock === 0 ? 'sold out' : r.yuyutei.stock != null ? `${r.yuyutei.stock} in stock` : undefined,
      url: r.yuyutei.url,
    });
  if (r.snkrdunk.ok && r.snkrdunk.lowestAskJpy)
    out.push({
      source: 'snkrdunk',
      label: 'SNKRDUNK',
      jpy: r.snkrdunk.lowestAskJpy,
      note: r.snkrdunk.listingCount ? `${r.snkrdunk.listingCount} listings` : undefined,
      url: r.snkrdunk.url,
    });
  if (r.mercari.ok && r.mercari.activeLowestJpy)
    out.push({ source: 'mercari', label: 'Mercari', jpy: r.mercari.activeLowestJpy, note: 'lowest active listing', url: r.mercari.url });
  return out;
}

export function reportSell(r: CardReport, ref: SellRef): number | null {
  if (!r.cardmarket.ok) return null;
  return r.cardmarket[ref] ?? r.cardmarket.trend;
}
