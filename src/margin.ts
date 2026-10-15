import type { CardReport, Opportunity, SealedItem } from '../lib/types';
import type { BuySource, SellChannel, SellRef, Settings } from './state';

export interface BuyOption {
  source: Exclude<BuySource, 'cheapest'>;
  label: string;
  jpy: number;
  note?: string;
  url?: string;
}

export interface Margin {
  buy: BuyOption | null;
  buyEur: number | null; // shop price in EUR
  sellEur: number | null; // Cardmarket reference price
  /** Net view (when costs are on): what the item costs landed in Germany, and what a sale brings in. */
  landedEur: number | null;
  proceedsEur: number | null;
  costs: CostBreakdown | null;
  marginEur: number | null;
  roi: number | null;
}

/** What it really costs to bring an item from Japan and sell it in Germany. */
export interface CostModel {
  proxyPct: number; // proxy / payment service fee on the item price
  shipEur: number; // shipping share per item, Japan → Germany
  dutyPct: number; // customs duty
  vatPct: number; // German import VAT (on goods + shipping + duty)
  sellFeePct: number; // fee of the selling channel
}

export interface CostBreakdown {
  proxy: number;
  ship: number;
  duty: number;
  vat: number;
  sellFee: number;
}

export const CHANNEL: Record<SellChannel, { label: string; feePct: number }> = {
  cardmarket: { label: 'Cardmarket (5 %)', feePct: 5 },
  ebay: { label: 'eBay privat (0 %)', feePct: 0 },
  ebayPro: { label: 'eBay gewerblich (11 %)', feePct: 11 },
  kleinanzeigen: { label: 'Kleinanzeigen (0 %)', feePct: 0 },
};

/** The cost model of the current settings, or null when margins are shown gross. */
export function costModel(s: Settings, sealed = false): CostModel | null {
  if (!s.net) return null;
  return {
    proxyPct: s.proxyPct,
    shipEur: sealed ? s.shipSealedEur : s.shipEur,
    dutyPct: s.dutyPct,
    vatPct: s.vatPct,
    sellFeePct: CHANNEL[s.sellChannel].feePct,
  };
}

/** Buy price (EUR) → landed cost in Germany. */
export function landedCost(buyEur: number, c: CostModel) {
  const proxy = (buyEur * c.proxyPct) / 100;
  const ship = c.shipEur;
  const duty = ((buyEur + ship) * c.dutyPct) / 100;
  const vat = ((buyEur + ship + duty) * c.vatPct) / 100;
  return { total: buyEur + proxy + ship + duty + vat, proxy, ship, duty, vat };
}

export const BUY_LABEL: Record<BuySource, string> = {
  cardrush: 'Card Rush',
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

export function computeMargin(buy: BuyOption | null, sellEur: number | null, jpyToEur: number, costs: CostModel | null = null): Margin {
  const buyEur = buy ? buy.jpy * jpyToEur : null;
  const landed = buyEur != null && costs ? landedCost(buyEur, costs) : null;
  const landedEur = landed?.total ?? buyEur;
  const sellFee = sellEur != null && costs ? (sellEur * costs.sellFeePct) / 100 : 0;
  const proceedsEur = sellEur != null ? sellEur - sellFee : null;
  const marginEur = landedEur != null && proceedsEur != null ? proceedsEur - landedEur : null;
  return {
    buy,
    buyEur,
    sellEur,
    landedEur,
    proceedsEur,
    costs: landed ? { proxy: landed.proxy, ship: landed.ship, duty: landed.duty, vat: landed.vat, sellFee } : null,
    marginEur,
    roi: marginEur != null && landedEur ? marginEur / landedEur : null,
  };
}

/** Yuyu-tei blocks cloud servers, so its prices can be days old; only fresh ones are a buy price. */
const YYT_FRESH_MS = 48 * 3600_000;
const isFresh = (asOf: string | null | undefined) => !asOf || Date.now() - Date.parse(asOf) < YYT_FRESH_MS;

const stockNote = (stock: number | null | undefined) => (stock === 0 ? 'ausverkauft' : stock != null ? `${stock} auf Lager` : undefined);

export function opportunityMargin(o: Opportunity, s: Settings, jpyToEur: number): Margin {
  const options: BuyOption[] = [];
  if (o.crJpy && (s.includeSoldOut || o.crStock !== 0))
    options.push({ source: 'cardrush', label: 'Card Rush', jpy: o.crJpy, note: o.crStock === 0 ? 'ausverkauft' : undefined });
  if (o.yytJpy && isFresh(o.yytAsOf) && (s.includeSoldOut || o.yytStock !== 0))
    options.push({ source: 'yuyutei', label: 'Yuyu-tei', jpy: o.yytJpy, note: o.yytStock === 0 ? 'ausverkauft' : undefined });
  if (o.snkAskJpy) options.push({ source: 'snkrdunk', label: 'SNKRDUNK', jpy: o.snkAskJpy });
  const sell = s.sellRef === 'trend' ? o.cmTrend : s.sellRef === 'avg30' ? o.cmAvg30 : s.sellRef === 'low' ? o.cmLow : o.cmTrend;
  // The daily scan has no Mercari prices: fall back to the cheapest scanned source instead of hiding the card.
  return computeMargin(pickBuy(options, s.buySource, true), sell, jpyToEur, costModel(s));
}

export function reportBuyOptions(r: CardReport, includeSoldOut: boolean): BuyOption[] {
  const out: BuyOption[] = [];
  if (r.cardrush.ok && (includeSoldOut || r.cardrush.stock !== 0))
    out.push({ source: 'cardrush', label: 'Card Rush', jpy: r.cardrush.priceJpy, note: stockNote(r.cardrush.stock), url: r.cardrush.url });
  if (r.yuyutei.ok && isFresh(r.yuyutei.asOf) && (includeSoldOut || r.yuyutei.stock !== 0))
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

/** Buy options for a sealed product (Card Rush shop price, SNKRDUNK lowest ask). */
export function sealedBuyOptions(x: SealedItem, includeSoldOut: boolean): BuyOption[] {
  const out: BuyOption[] = [];
  if (x.crJpy && (includeSoldOut || x.crStock !== 0)) out.push({ source: 'cardrush', label: 'Card Rush', jpy: x.crJpy, note: stockNote(x.crStock), url: x.crUrl ?? undefined });
  if (x.snkAskJpy) out.push({ source: 'snkrdunk', label: 'SNKRDUNK', jpy: x.snkAskJpy, url: x.snkId ? `https://snkrdunk.com/apparels/${x.snkId}` : undefined });
  return out;
}

export function reportSell(r: CardReport, ref: SellRef): number | null {
  if (!r.cardmarket.ok) return null;
  return r.cardmarket[ref] ?? r.cardmarket.trend;
}

/** Germany → Japan: buy on Cardmarket, sell to Card Rush's buyback (買取). */
export interface ReverseDeal {
  buyEur: number; // Cardmarket price paid
  costEur: number; // buy + shipping to Japan
  payoutEur: number; // Card Rush buy price in EUR
  marginEur: number;
  roi: number;
}

export function reverseMargin(o: Opportunity, s: Settings, jpyToEur: number): ReverseDeal | null {
  const buy = s.sellRef === 'low' ? o.cmLow ?? o.cmTrend : s.sellRef === 'avg30' ? o.cmAvg30 ?? o.cmTrend : o.cmTrend;
  if (!buy || !o.crBuyJpy) return null;
  const costEur = buy + (s.net ? s.revShipEur : 0);
  const payoutEur = o.crBuyJpy * jpyToEur;
  const marginEur = payoutEur - costEur;
  return { buyEur: buy, costEur, payoutEur, marginEur, roi: marginEur / costEur };
}
