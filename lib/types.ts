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

export type SourceResult<T> = ({ ok: true } & T) | { ok: false; error: string; url?: string };

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
  yuyutei: SourceResult<YuyuteiPrice>;
  snkrdunk: SourceResult<SnkrdunkData>;
  mercari: SourceResult<MercariData>;
  pricecharting: SourceResult<PriceChartingData>;
  fetchedAt: string;
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
  cmLow: number | null;
  yytJpy: number | null;
  yytStock: number | null;
  yytUrl: string | null;
  yytAsOf?: string | null; // date of the Yuyu-tei price when carried over from an earlier scan
  snkAskJpy: number | null;
  snkId?: number | null;
  snkImg?: string | null;
}

export interface OpportunityFile {
  generatedAt: string;
  fx: FxRates;
  sets: { id: string; name: string }[];
  items: Opportunity[];
}

/** History file per set: cardId -> rows of [yyyy-mm-dd, cmTrend, cmAvg30, yytJpy]. */
export type HistoryFile = Record<string, [string, number | null, number | null, number | null][]>;

export interface ChartPoint {
  t: number;
  v: number;
}
