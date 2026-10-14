// SNKRDUNK (スニダン): Japan's largest card resale marketplace. Provides lowest asks,
// every completed trade with condition (A/B/PSA10/...), and daily sold-price charts.
import { cached, decodeHtml, getJson, getText, median } from './http.js';
import type { ChartPoint, SnkrdunkData, SnkrdunkTrade } from './types.js';

const BASE = 'https://snkrdunk.com';

export interface SnkrdunkHit {
  id: number;
  label: string;
  priceJpy: number | null;
  image: string | null;
}

/** Search via the server-rendered search page and return product tiles. */
export function searchSnkrdunk(keywords: string): Promise<SnkrdunkHit[]> {
  return cached(`snk:search:${keywords}`, 6 * 3600_000, async () => {
    const html = await getText(`${BASE}/search?keywords=${encodeURIComponent(keywords)}`);
    const hits = new Map<number, SnkrdunkHit>();
    for (const m of html.matchAll(/apparels\/(\d+)"[^>]*aria-label="([^"]+)"/g)) {
      const id = Number(m[1]);
      const label = decodeHtml(m[2]);
      const price = label.match(/¥([\d,]+)\s*$/);
      // The tile's product photo follows the link within the same tile.
      const tile = html.slice(m.index! + m[0].length, m.index! + m[0].length + 1500).split('</a>')[0];
      const image = tile.match(/src="(https:\/\/cdn\.snkrdunk\.com\/[^"?]+)/)?.[1] ?? null;
      if (!hits.has(id)) hits.set(id, { id, label, priceJpy: price ? Number(price[1].replace(/,/g, '')) : null, image });
    }
    return [...hits.values()];
  });
}

/**
 * Locate the exact Japanese card: labels look like "リザードンex SAR [SV2a 201/165](...) - ¥41,000".
 * The price in the label is the current lowest ask, so one request gives both.
 */
export async function findSnkrdunk(setId: string, number: string): Promise<SnkrdunkHit | null> {
  const hits = await searchSnkrdunk(`${setId} ${number}`);
  const tag = `[${setId} ${number}]`.toLowerCase();
  return hits.find((h) => h.label.toLowerCase().includes(tag)) ?? null;
}

export const findSnkrdunkId = async (setId: string, number: string) => (await findSnkrdunk(setId, number))?.id ?? null;

interface RawApparel {
  id: number;
  productCatalogId?: number;
  usedMinPrice?: number;
  usedListingCount?: number;
  primaryMedia?: { imageUrl?: string };
}

export async function getSnkrdunk(id: number): Promise<SnkrdunkData> {
  return cached(`snk:item:${id}`, 30 * 60_000, async () => {
    const a = await getJson<RawApparel>(`${BASE}/v1/apparels/${id}`);
    let trades: SnkrdunkTrade[] = [];
    if (a.productCatalogId) {
      const th = await getJson<{ trades?: { price: number; soldAt: string; title: string }[] }>(
        `${BASE}/v3/products/${a.productCatalogId}/trading-history?page=1&perPage=60`,
      ).catch(() => ({ trades: [] }));
      trades = (th.trades ?? []).map((t) => ({ priceJpy: t.price, soldAt: t.soldAt, condition: t.title }));
    }
    const of = (cond: string) => median(trades.filter((t) => t.condition === cond).slice(0, 15).map((t) => t.priceJpy));
    // Recent trades are often dominated by graded copies; the daily A-condition sales
    // chart of the last month gives a steadier raw price.
    const rawDaily = await getSnkrdunkChart(id, SNK_CONDITIONS.raw, 'oneMonth').catch(() => []);
    const rawMedianJpy = rawDaily.length >= 3 ? median(rawDaily.slice(-15).map((p) => p.v)) : of('A');
    return {
      url: `${BASE}/apparels/${id}`,
      id,
      catalogId: a.productCatalogId ?? null,
      lowestAskJpy: a.usedMinPrice || null,
      listingCount: a.usedListingCount ?? null,
      image: a.primaryMedia?.imageUrl ?? null,
      trades,
      rawMedianJpy,
      psa10MedianJpy: of('PSA10'),
      psa9MedianJpy: of('PSA9'),
    };
  });
}

/** Chart condition ids used by SNKRDUNK: 18 = A (near mint raw), 22 = PSA10, 23 = PSA9. */
export const SNK_CONDITIONS = { raw: 18, psa10: 22, psa9: 23 } as const;
export const SNK_RANGES = ['oneWeek', 'oneMonth', 'threeMonths', 'all'] as const;

export function getSnkrdunkChart(id: number, condition: number, range: string): Promise<ChartPoint[]> {
  return cached(`snk:chart:${id}:${condition}:${range}`, 60 * 60_000, async () => {
    const d = await getJson<{ points?: [number, number][] }>(
      `${BASE}/v1/apparels/${id}/sales-chart/used?range=${range}&salesChartOptionId=${condition}`,
    );
    return (d.points ?? []).map(([t, v]) => ({ t, v }));
  });
}
