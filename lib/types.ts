// Shapes shared by the API, the scanner and the frontend.

export interface CardSummary {
  id: string; // TCGdex Japanese card id, e.g. "SV2a-201"
  setId: string; // "SV2a"
  setName: string; // Japanese set name
  localId: string; // "201"
  number: string; // "201/165"
  nameJa: string;
  nameEn: string | null;
  rarity: string | null;
  image: string | null; // TCGdex image base (append /high.webp or /low.webp)
  externalImage?: string | null; // full image URL for cards not in TCGdex (ids "snk-…")
}

export interface CardDetail extends CardSummary {
  illustrator: string | null;
  releaseDate: string | null;
  dexId: number[];
}

export type SourceResult<T> = ({ ok: true } & T) | { ok: false; error: string; url?: string; pending?: boolean };

export interface CardmarketPrices {
  url: string;
  idProduct: number | null;
  trend: number | null;
  low: number | null;
  avg: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  updated: string | null;
  matched?: 'tcgdex' | 'name'; // how the Cardmarket product was identified
}

export interface YuyuteiPrice {
  url: string;
  priceJpy: number;
  stock: number | null; // null = unknown, 0 = sold out
  image: string | null;
  asOf?: string; // set when the price comes from the daily scan instead of a live fetch
}

/** Card Rush (カードラッシュ): Japan's reference shop price for a card. */
export interface CardRushPrice {
  url: string; // shop product page
  productId: number;
  priceJpy: number; // shop sell price (what a buyer pays)
  stock: number;
  buyJpy: number | null; // Card Rush buy price (what they pay you)
  name: string;
  rarity: string;
  number: string; // "201/165"
  variant: string; // '' = normal print; else e.g. "マスターボールミラー", "未開封BOX"
  updatedAt: string;
}

export interface SnkrdunkTrade {
  priceJpy: number;
  soldAt: string;
  condition: string; // "A", "B", "PSA10" ...
}

export interface SnkrdunkData {
  url: string;
  id: number;
  catalogId: number | null;
  lowestAskJpy: number | null;
  listingCount: number | null;
  image: string | null;
  trades: SnkrdunkTrade[];
  rawMedianJpy: number | null; // median of recent A-condition trades
  psa10MedianJpy: number | null;
  psa9MedianJpy: number | null;
}

export interface MercariItem {
  id: string;
  name: string;
  priceJpy: number;
  sold: boolean;
  updated: string;
  thumb: string | null;
  url: string;
}

export interface MercariData {
  url: string;
  items: MercariItem[];
  soldMedianJpy: number | null;
  soldCount: number;
  activeLowestJpy: number | null;
}

export interface PriceChartingData {
  url: string;
  title: string;
  ungradedUsd: number | null;
  grade9Usd: number | null;
  psa10Usd: number | null;
}

export interface FxRates {
  date: string;
  jpyToEur: number; // 1 JPY in EUR
  usdToEur: number; // 1 USD in EUR
  source: string;
}

export interface CardReport {
  card: CardDetail;
  fx: FxRates;
  links: Record<string, string>;
  cardmarket: SourceResult<CardmarketPrices>;
  cardrush: SourceResult<CardRushPrice>;
  yuyutei: SourceResult<YuyuteiPrice>;
  snkrdunk: SourceResult<SnkrdunkData>;
  mercari: SourceResult<MercariData>;
  pricecharting: SourceResult<PriceChartingData>;
  fetchedAt: string;
  partial?: boolean; // core only (card + Cardmarket); market sources still loading
  sell?: { query: string; ebaySold: string; ebayLive: string; kleinanzeigen: string; nameDe: string | null };
}

/** One row of the daily scanner output (public/data/opportunities.json). */
export interface Opportunity {
  id: string;
  setId: string;
  setName: string;
  number: string;
  nameJa: string;
  nameEn: string | null;
  rarity: string | null;
  image: string | null;
  cmTrend: number | null;
  cmAvg30: number | null;
  cmAvg7?: number | null;
  cmLow: number | null;
  cmId?: number | null; // Cardmarket idProduct (for live re-pricing)
  yytJpy: number | null;
  yytStock: number | null;
  yytUrl: string | null;
  yytAsOf?: string | null; // date of the Yuyu-tei price when carried over from an earlier scan
  snkAskJpy: number | null;
  crJpy?: number | null; // Card Rush sell price
  crStock?: number | null;
  crBuyJpy?: number | null; // Card Rush buy price (買取)
  crId?: number | null; // Card Rush shop product id
  snkId?: number | null;
  snkImg?: string | null;
}

/** A Japanese booster box or pack, priced on Cardmarket (EUR) and SNKRDUNK (JPY). */
export interface SealedItem {
  id: string; // "cm-<Cardmarket idProduct>"
  kind: 'box' | 'pack';
  setId: string;
  setName: string; // Japanese set name
  nameEn: string; // Cardmarket product name
  cmUrl: string;
  cmTrend: number | null;
  cmAvg30: number | null;
  cmLow: number | null;
  snkId: number | null;
  snkAskJpy: number | null;
  snkLabel: string | null;
  image: string | null;
  crJpy?: number | null; // Card Rush sell price
  crStock?: number | null;
  crBuyJpy?: number | null;
  crUrl?: string | null;
}

/**
 * Daily market index (public/data/market.json): per day and set, the sum of the Cardmarket trend
 * prices of all tracked cards, the sum of their Card Rush prices (JPY) and how many cards that is.
 */
export interface MarketFile {
  updated: string;
  days: Record<string, Record<string, [number, number, number]>>;
}

export interface OpportunityFile {
  generatedAt: string;
  fx: FxRates;
  sets: { id: string; name: string }[];
  items: Opportunity[];
  sealed?: SealedItem[];
}

/** History file per set: cardId -> rows of [yyyy-mm-dd, cmTrend, cmAvg30, yytJpy, crJpy?, crBuyJpy?]. */
export type HistoryFile = Record<string, [string, number | null, number | null, number | null, (number | null)?, (number | null)?][]>;

export interface ChartPoint {
  t: number;
  v: number;
}
