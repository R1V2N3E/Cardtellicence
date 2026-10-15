// Sealed products (booster boxes and packs) of Japanese sets:
//   Cardmarket: the set's Japanese expansion → its "Display" (box) and "Booster" products,
//               priced from the official price guide.
//   SNKRDUNK:   the same box/pack in Japan (box product number "pkmn-tcg-<SET>"), lowest ask.
import { getProducts, officialPrices } from './cardmarket.js';
import { cached, getJson } from './http.js';
import { cardmarketFor } from './prices.js';
import { searchSnkrdunk, type SnkrdunkHit } from './snkrdunk.js';
import { getRawCard, getSet } from './tcgdex.js';
import type { ChartPoint, SealedItem } from './types.js';

interface CmNonSingle {
  idProduct: number;
  name: string;
  categoryName: string;
  idExpansion: number;
}

const NONSINGLES = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json';

export const getNonSingles = () =>
  cached('cm:nonsingles', 12 * 3600_000, async () => (await getJson<{ products: CmNonSingle[] }>(NONSINGLES)).products);

/** Cardmarket expansion id of a Japanese set, found through any of its mapped singles. */
export function expansionOf(setId: string): Promise<number | null> {
  return cached(`cm:exp:${setId}`, 24 * 3600_000, async () => {
    const set = await getSet(setId);
    const byId = new Map((await getProducts()).map((p) => [p.idProduct, p.idExpansion]));
    for (const c of [...set.cards].reverse().slice(0, 12)) {
      const raw = await getRawCard(c.id).catch(() => null);
      const cm = raw ? await cardmarketFor(raw).catch(() => null) : null;
      const exp = cm?.idProduct ? byId.get(cm.idProduct) : undefined;
      if (exp) return exp;
    }
    return null;
  });
}

const cmSearchUrl = (name: string) =>
  `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}&language=7`;

const productNumber = (id: number) =>
  cached(`snk:pn:${id}`, 7 * 24 * 3600_000, async () => (await getJson<{ productNumber?: string }>(`https://snkrdunk.com/v1/apparels/${id}`)).productNumber ?? null);

/**
 * SNKRDUNK boxes/packs of one set. Search by set name and by set code, then accept only products
 * whose product number is exactly this set's ("pkmn-tcg-SV2a"). Names alone are not reliable
 * (TCGdex has e.g. the wrong Japanese name for SV4a), and a wrong match would fake a margin.
 */
async function snkSealedCandidates(setId: string, setName: string): Promise<SnkrdunkHit[]> {
  // SNKRDUNK spells prefixes differently ("TAG TEAM GX" → "タッグチームGX"), so also try the
  // last word of the name alone.
  const names = [...new Set([`「${setName}」`, coreName(setName)])];
  const queries = [...names.flatMap((n) => [`${n} パック`, `${n} ボックス`]), `${setId} パック`, `${setId} ボックス`];
  const seen = new Map<number, SnkrdunkHit>();
  for (const q of queries) for (const h of await searchSnkrdunk(q).catch(() => [])) if (!h.label.includes('[')) seen.set(h.id, h);
  return [...seen.values()].filter((h) => /パック|ボックス|BOX/i.test(h.label) && !/シュリンクなし|カートン|まとめ|セット|英語版|【海外/.test(h.label));
}

const coreName = (setName: string) => setName.split(/\s+/).pop() ?? setName;

async function snkSealedFor(setId: string, setName: string): Promise<SnkrdunkHit[]> {
  const verified: SnkrdunkHit[] = [];
  for (const h of (await snkSealedCandidates(setId, setName)).slice(0, 12)) {
    const pn = await productNumber(h.id).catch(() => null);
    if (pn?.toLowerCase() === `pkmn-tcg-${setId}`.toLowerCase()) verified.push(h);
  }
  return verified;
}

const isPack = (h: SnkrdunkHit) => h.label.includes('パック') && !h.label.includes('ボックス');

/** Photo of a set's booster pack (falls back to the box), verified like the sealed prices. */
export function packImage(setId: string): Promise<string> {
  // Misses throw so they aren't cached.
  return cached(`pack-img:${setId}`, 7 * 24 * 3600_000, async () => {
    const set = await getSet(setId);
    let hits = (await snkSealedFor(setId, set.name)).filter((h) => h.image);
    // Older products carry no set code ("pkmn-20"); for a picture, the set name in the label is
    // enough (prices still require the exact product number).
    const core = coreName(set.name);
    if (!hits.length && core.length >= 4)
      hits = (await snkSealedCandidates(setId, set.name)).filter((h) => h.image && h.label.includes(core));
    const hit = hits.find(isPack) ?? hits.find((h) => h.label.includes('ボックス')) ?? hits[0];
    if (!hit?.image) throw new Error('no pack image');
    return hit.image;
  });
}

/** Box and pack of one Japanese set, with Cardmarket and SNKRDUNK prices. */
export async function sealedForSet(setId: string): Promise<SealedItem[]> {
  const [set, exp] = await Promise.all([getSet(setId), expansionOf(setId)]);
  if (!exp) return [];
  const products = (await getNonSingles()).filter((p) => p.idExpansion === exp && !/case|half/i.test(p.name));
  const box = products.find((p) => p.categoryName === 'Pokémon Display');
  const pack = products.find((p) => p.categoryName === 'Pokémon Booster');

  const verified = await snkSealedFor(setId, set.name);
  const snkBox = verified.find((h) => h.label.includes('ボックス'));
  const snkPack = verified.find(isPack);

  const out: SealedItem[] = [];
  for (const [kind, cm, snk] of [
    ['box', box, snkBox],
    ['pack', pack, snkPack],
  ] as const) {
    if (!cm) continue;
    const prices = await officialPrices(cm.idProduct, cmSearchUrl(cm.name)).catch(() => null);
    if (!prices?.trend) continue;
    out.push({
      id: `cm-${cm.idProduct}`,
      kind,
      setId,
      setName: set.name,
      nameEn: cm.name,
      cmUrl: cmSearchUrl(cm.name),
      cmTrend: prices.trend,
      cmAvg30: prices.avg30,
      cmLow: prices.low,
      snkId: snk?.id ?? null,
      snkAskJpy: snk?.priceJpy ?? null,
      snkLabel: snk?.label.replace(/\s*-\s*¥[\d,]*\s*$/, '') ?? null,
      image: snk?.image ?? null,
    });
  }
  return out;
}

/** Daily sold prices of a sealed product on SNKRDUNK (new items have no condition filter). */
export function getSnkrdunkSealedChart(id: number, range: string): Promise<ChartPoint[]> {
  return cached(`snk:schart:${id}:${range}`, 60 * 60_000, async () => {
    const d = await getJson<{ points?: [number, number][] }>(`https://snkrdunk.com/v1/apparels/${id}/sales-chart?range=${range}`);
    const pts = (d.points ?? []).map(([t, v]) => ({ t, v }));
    // The chart mixes in multi-box/carton sales; keep prices near the typical single-box level.
    const sorted = pts.map((p) => p.v).sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return pts.filter((p) => p.v <= mid * 1.5 && p.v >= mid * 0.5);
  });
}

/** Current Cardmarket prices for a sealed id "cm-<idProduct>". */
export async function sealedPrices(id: string) {
  const idProduct = Number(id.slice(3));
  return officialPrices(idProduct, '');
}
