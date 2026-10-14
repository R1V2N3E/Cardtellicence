// Cardmarket's official public data exports (refreshed daily by Cardmarket):
//   price guide: trend / low / avg / 1-7-30 day averages per product (EUR)
//   product list: every Pokémon single with name, expansion id and date added
// Category 6 = Pokémon.
import { cached, request } from './http.js';
import type { CardmarketPrices } from './types.js';

const BASE = 'https://downloads.s3.cardmarket.com/productCatalog';
const PRICE_GUIDE = `${BASE}/priceGuide/price_guide_6.json`;
const PRODUCTS = `${BASE}/productList/products_singles_6.json`;

interface RawGuide {
  idProduct: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
}
export interface CmProduct {
  idProduct: number;
  name: string;
  idExpansion: number;
  dateAdded: string;
}


export function getPriceGuide(): Promise<{ createdAt: string; byId: Map<number, RawGuide> }> {
  return cached('cm:guide', 6 * 3600_000, async () => {
    const res = await request(PRICE_GUIDE, {}, 25000);
    const data = (await res.json()) as { createdAt: string; priceGuides: RawGuide[] };
    return { createdAt: data.createdAt, byId: new Map(data.priceGuides.map((g) => [g.idProduct, g])) };
  });
}

export function getProducts(): Promise<CmProduct[]> {
  return cached('cm:products', 12 * 3600_000, async () => {
    const res = await request(PRODUCTS, {}, 25000);
    return ((await res.json()) as { products: CmProduct[] }).products;
  });
}

const pos = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : null);

export async function officialPrices(idProduct: number, url: string): Promise<CardmarketPrices | null> {
  const { createdAt, byId } = await getPriceGuide();
  const g = byId.get(idProduct);
  if (!g) return null;
  return {
    url,
    idProduct,
    trend: pos(g.trend),
    low: pos(g.low),
    avg: pos(g.avg),
    avg1: pos(g.avg1),
    avg7: pos(g.avg7),
    avg30: pos(g.avg30),
    updated: new Date(createdAt).toISOString(),
  };
}

const base = (name: string) => name.replace(/\s*\[.*$/, '').toLowerCase();

/**
 * Map a Japanese set to its Cardmarket expansion when TCGdex has no product ids.
 * Within an expansion, products sorted by id follow the card numbers (product #n = card n),
 * so we score every expansion by how many positions carry the expected Pokémon name.
 * Returns localId -> idProduct for positions whose name agrees (or that have no Pokémon name).
 */
export async function mapSetByNames(
  cards: { localId: string; nameEn: string | null }[],
  releaseDate: string | null,
): Promise<Map<string, number>> {
  const products = await getProducts();
  const byExp = new Map<number, CmProduct[]>();
  for (const p of products) {
    const list = byExp.get(p.idExpansion);
    list ? list.push(p) : byExp.set(p.idExpansion, [p]);
  }
  const numbered = cards.filter((c) => /^\d+$/.test(c.localId));
  const named = numbered.filter((c) => c.nameEn);
  if (named.length < 5) return new Map();
  const release = releaseDate ? Date.parse(releaseDate) : null;

  let best: { score: number; sorted: CmProduct[] } | null = null;
  for (const list of byExp.values()) {
    if (list.length < numbered.length * 0.8 || list.length > numbered.length * 1.6) continue;
    const sorted = [...list].sort((a, b) => a.idProduct - b.idProduct);
    if (release && sorted[0].dateAdded.startsWith('20')) {
      // Japanese products are added around the Japanese release; the later English
      // printing of the same set would otherwise look similar.
      const days = Math.abs(Date.parse(sorted[0].dateAdded) - release) / 86400_000;
      if (days > 45) continue;
    }
    let hits = 0;
    for (const c of named) {
      const p = sorted[Number(c.localId) - 1];
      if (p && base(p.name).includes(c.nameEn!.toLowerCase().replace(/ (ex|gx|v|vmax|vstar)$/i, ''))) hits++;
    }
    const score = hits / named.length;
    if (!best || score > best.score) best = { score, sorted };
  }
  const out = new Map<string, number>();
  if (!best || best.score < 0.7) return out;
  for (const c of numbered) {
    const p = best.sorted[Number(c.localId) - 1];
    if (!p) continue;
    const want = c.nameEn?.toLowerCase().replace(/ (ex|gx|v|vmax|vstar)$/i, '');
    if (!want || base(p.name).includes(want)) out.set(c.localId, p.idProduct);
  }
  return out;
}
