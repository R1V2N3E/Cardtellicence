// PriceCharting: tracks completed eBay sales worldwide, including Japanese Pokémon cards
// graded by PSA. Used as the graded (PSA 9 / PSA 10) reference price for the EU side.
import { cached, decodeHtml, getText } from './http.js';
import type { ChartPoint, PriceChartingData } from './types.js';

const BASE = 'https://www.pricecharting.com';

const price = (html: string, id: string) => {
  const m = html.match(new RegExp(`id="${id}"[\\s\\S]*?<span class="price js-price">\\s*\\$([\\d,.]+)`));
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

export interface PriceChartingPage extends PriceChartingData {
  chart: Record<'ungraded' | 'psa10', ChartPoint[]>;
}

function parseProduct(html: string, url: string): PriceChartingPage {
  const title = decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s*\|\s*Pokemon Cards\s*$/, '');
  // Chart data is cents per month: used = ungraded, manualonly = PSA 10.
  const chartJson = html.match(/VGPC\.chart_data = (\{[\s\S]*?\});/)?.[1];
  const chart: PriceChartingPage['chart'] = { ungraded: [], psa10: [] };
  if (chartJson) {
    try {
      const data = JSON.parse(chartJson) as Record<string, [number, number][]>;
      const pts = (k: string) => (data[k] ?? []).filter(([, v]) => v > 0).map(([t, v]) => ({ t, v: v / 100 }));
      chart.ungraded = pts('used');
      chart.psa10 = pts('manualonly');
    } catch {
      /* chart is optional */
    }
  }
  return {
    url,
    title,
    ungradedUsd: price(html, 'used_price'),
    grade9Usd: price(html, 'graded_price'),
    psa10Usd: price(html, 'manual_only_price'),
    chart,
  };
}

/** Find a Japanese card by English name and card number, e.g. ("Charizard ex", "201"). */
export function findPriceCharting(nameEn: string, localId: string): Promise<PriceChartingPage | null> {
  const n = String(Number(localId) || localId);
  const q = `pokemon japanese ${nameEn} ${n}`;
  return cached(`pc:${q}`, 6 * 3600_000, async () => {
    const res = await fetch(`${BASE}/search-products?q=${encodeURIComponent(q)}&type=prices`, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`PriceCharting blocked this server (HTTP ${res.status})`);
    const html = await res.text();
    if (res.url.includes('/game/')) {
      const page = parseProduct(html, res.url.split('?')[0]);
      return page.title.includes(`#${n}`) ? page : null;
    }
    // Several matches: take the first Japanese product whose title ends in "#<number>".
    for (const m of html.matchAll(/<td class="title">\s*<a href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/g)) {
      if (m[1].includes('pokemon-japanese') && decodeHtml(m[2]).endsWith(`#${n}`)) {
        return parseProduct(await getText(m[1]), m[1]);
      }
    }
    return null;
  });
}
