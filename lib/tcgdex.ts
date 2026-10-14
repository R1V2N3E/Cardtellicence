// TCGdex: open Pokémon TCG database with Japanese card data. Each Japanese card carries
// the Cardmarket product id of its *Japanese* Cardmarket listing plus Cardmarket's own
// daily price guide (trend, low, 1/7/30-day averages) in EUR.
import { cached, getJson } from './http.js';
import { englishName } from './pokedex.js';
import type { CardDetail, CardSummary, CardmarketPrices } from './types.js';

const BASE = 'https://api.tcgdex.net/v2/ja';
const DAY = 24 * 3600_000;

interface RawSetBrief {
  id: string;
  name: string;
  cardCount: { total: number; official: number };
}
interface RawSet extends RawSetBrief {
  releaseDate?: string;
  cards: { id: string; localId: string; name: string; image?: string }[];
}
interface RawCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
  illustrator?: string;
  dexId?: number[];
  set: { id: string; name: string; cardCount: { official: number; total: number } };
  variants_detailed?: {
    type: string;
    thirdParty?: { cardmarket?: number };
    pricing?: { cardmarket?: Record<string, any> | null };
  }[];
}

export const listSets = () => cached('tcgdex:sets', DAY, () => getJson<RawSetBrief[]>(`${BASE}/sets`));

export const getSet = (id: string) =>
  cached(`tcgdex:set:${id}`, DAY, () => getJson<RawSet>(`${BASE}/sets/${encodeURIComponent(id)}`));

export const getRawCard = (id: string) =>
  cached(`tcgdex:card:${id}`, 6 * 3600_000, () => getJson<RawCard>(`${BASE}/cards/${encodeURIComponent(id)}`));

// Printed set totals where TCGdex's "official" count differs from what is printed on the card.
const PRINTED_TOTAL: Record<string, number> = { SV11B: 86 };

export const printedTotal = (setId: string, official: number | undefined) => PRINTED_TOTAL[setId] ?? official;

export function formatNumber(localId: string, official: number | undefined): string {
  if (!official || !/^\d+$/.test(localId)) return localId;
  const width = Math.max(3, String(official).length);
  return `${localId.padStart(width, '0')}/${String(official).padStart(width, '0')}`;
}

export function toDetail(raw: RawCard, releaseDate: string | null = null): CardDetail {
  return {
    id: raw.id,
    setId: raw.set.id,
    setName: raw.set.name,
    localId: raw.localId,
    number: formatNumber(raw.localId, printedTotal(raw.set.id, raw.set.cardCount?.official)),
    nameJa: raw.name,
    nameEn: englishName(raw.name, raw.dexId),
    rarity: raw.rarity ?? null,
    image: raw.image ?? null,
    illustrator: raw.illustrator ?? null,
    releaseDate,
    dexId: raw.dexId ?? [],
  };
}

export function toSummary(raw: RawCard): CardSummary {
  const { illustrator, releaseDate, dexId, ...summary } = toDetail(raw);
  return summary;
}

const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);

export function cardmarketFromRaw(raw: RawCard): CardmarketPrices | null {
  // Prefer the variant that actually has a price (holo cards usually have one variant).
  const variants = raw.variants_detailed ?? [];
  const v = variants.find((x) => x.pricing?.cardmarket?.trend) ?? variants.find((x) => x.thirdParty?.cardmarket);
  if (!v) return null;
  const p = v.pricing?.cardmarket ?? {};
  const idProduct: number | null = p.idProduct ?? v.thirdParty?.cardmarket ?? null;
  return {
    url: cardmarketUrl(idProduct, raw),
    idProduct,
    trend: num(p.trend),
    low: num(p.low),
    avg: num(p.avg),
    avg1: num(p.avg1),
    avg7: num(p.avg7),
    avg30: num(p.avg30),
    updated: p.updated ?? null,
  };
}

/** Cardmarket search for the card (Japanese-language offers, language=7). */
export function cardmarketUrl(_idProduct: number | null, raw: Pick<RawCard, 'name' | 'dexId'>): string {
  const q = englishName(raw.name, raw.dexId) ?? raw.name;
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(q)}&language=7`;
}

export async function getCard(id: string) {
  const raw = await getRawCard(id);
  const set = await getSet(raw.set.id).catch(() => null);
  return { raw, detail: toDetail(raw, set?.releaseDate ?? null) };
}

/** Brief card list search via TCGdex filters. */
export async function searchCards(params: Record<string, string>, limit = 60) {
  const qs = new URLSearchParams({ ...params, 'pagination:itemsPerPage': String(limit) });
  return cached(`tcgdex:search:${qs}`, 6 * 3600_000, () =>
    getJson<{ id: string; localId: string; name: string; image?: string }[]>(`${BASE}/cards?${qs}`),
  );
}
