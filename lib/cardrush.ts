// カードラッシュ (Card Rush): Japan's reference shop for Pokémon card values.
// The shop itself (cardrush-pokemon.jp) sits behind a Cloudflare bot challenge, but Card Rush's
// own media site (cardrush.media) publishes its price list as server-rendered pages: for every
// single it buys, the buy price (買取) plus the shop's sell price and stock. One page holds 100
// cards and can be filtered by set code, so a whole set costs 1–4 requests. Its /api is
// disallowed in robots.txt, so only the public pages are read.
import { cached, getText } from './http.js';
import type { CardRushPrice } from './types.js';

export type { CardRushPrice };

const BASE = 'https://cardrush.media/pokemon/buying_prices';
const SHOP = 'https://www.cardrush-pokemon.jp';

interface RawBuyingPrice {
  name: string;
  extra_difference: string;
  rarity: string;
  model_number: string;
  pack_code: string;
  pack_name: string;
  amount: number;
  display_category: string;
  updated_at: string;
  ocha_product?: { id: number; price: number | null; stock_count: number | null } | null;
}

interface PageProps {
  buyingPrices: RawBuyingPrice[];
  lastPage: number;
}

function query(params: [string, string][], page: number): string {
  const q = new URLSearchParams([
    ['displayMode', 'リスト'],
    ['limit', '100'],
    ['page', String(page)],
    ['sort[key]', 'amount'],
    ['sort[order]', 'desc'],
    ['associations[]', 'ocha_product'],
    ['to_json_option[include][ocha_product][only][]', 'id'],
    ['to_json_option[include][ocha_product][only][]', 'price'],
    ['to_json_option[include][ocha_product][only][]', 'stock_count'],
    ...params,
  ]);
  return `${BASE}?${q}`;
}

export function parsePage(html: string): PageProps {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Card Rush page without data');
  const props = JSON.parse(m[1]).props?.pageProps;
  if (!Array.isArray(props?.buyingPrices)) throw new Error('Card Rush page format changed');
  return { buyingPrices: props.buyingPrices, lastPage: Number(props.lastPage) || 1 };
}

function toPrice(r: RawBuyingPrice): CardRushPrice | null {
  const p = r.ocha_product;
  if (!p?.id || !p.price) return null;
  return {
    url: `${SHOP}/product/${p.id}`,
    productId: p.id,
    priceJpy: p.price,
    stock: p.stock_count ?? 0,
    buyJpy: r.amount || null,
    name: r.name,
    rarity: r.rarity,
    number: r.model_number,
    variant: r.extra_difference ?? '',
    updatedAt: r.updated_at,
  };
}

/** Every page of one filtered list (pages are fetched one after another, politely). */
async function allPages(params: [string, string][], maxPages = 8): Promise<RawBuyingPrice[]> {
  const first = parsePage(await getText(query(params, 1)));
  const rows = [...first.buyingPrices];
  for (let page = 2; page <= Math.min(first.lastPage, maxPages); page++) rows.push(...parsePage(await getText(query(params, page))).buyingPrices);
  return rows;
}

/**
 * Variant labels that mark a different product than the normal print of that number (mirror
 * parallels, unopened promos, first editions, graded slabs). Labels like "SA" (special art) only
 * describe the card itself and are kept.
 */
const PARALLEL = /ミラー|未開封|1ED|PSA|BGS|ARS|仕様|エラー|サイン|プロモ|シュリンク/;

/** Between two listings of the same number: the plain one, then the one in stock, then the cheaper. */
function better(a: CardRushPrice, b: CardRushPrice): boolean {
  if (!a.variant !== !b.variant) return !a.variant;
  if (a.stock > 0 !== b.stock > 0) return a.stock > 0;
  return a.priceJpy < b.priceJpy;
}

/** Card Rush spells older set codes in lower case ("sm12a", "sm3H"); try the likely spellings. */
export function packCodes(setId: string): string[] {
  return [...new Set([setId, setId.replace(/^[A-Z]+/, (p) => p.toLowerCase()), setId.toLowerCase()])];
}

/**
 * All singles of one set at Card Rush, by card number. Only the normal print is kept
 * (mirrors, unopened promos etc. are different products). Cached 30 minutes: Card Rush
 * updates its prices during the day.
 */
export function cardrushSet(setId: string): Promise<Map<string, CardRushPrice>> {
  return cached(`cr:set:${setId}`, 30 * 60_000, async () => {
    // Card Rush files most of an older set under "sm6" but a few cards under "SM6": read every
    // spelling and merge. Only rows whose code is exactly this set count (never "SM9a" for "SM9").
    const out = new Map<string, CardRushPrice>();
    for (const code of packCodes(setId)) {
      for (const r of await allPages([['pack_code', code]])) {
        if (r.pack_code?.toLowerCase() !== setId.toLowerCase() || PARALLEL.test(r.extra_difference ?? '')) continue;
        const p = toPrice(r);
        const prev = p && out.get(p.number);
        if (p && (!prev || better(p, prev))) out.set(p.number, p);
      }
    }
    return out;
  });
}

export async function findCardrush(setId: string, number: string): Promise<CardRushPrice | null> {
  return (await cardrushSet(setId)).get(number) ?? null;
}

export const cardrushSearchUrl = (keyword: string) => `${SHOP}/product-list?keyword=${encodeURIComponent(keyword)}`;

/**
 * The booster box and pack of a set at Card Rush. Sealed products are listed by name
 * (「拡張パック『クレイバースト』」), so the set name must appear in 『』 — this skips gift sets
 * and Pokémon Center bundles that merely contain the set's name.
 */
export function cardrushSealed(setName: string): Promise<{ box: CardRushPrice | null; pack: CardRushPrice | null }> {
  const core = setName.split(/\s+/).pop() ?? setName;
  return cached(`cr:sealed:${core}`, 30 * 60_000, async () => {
    const rows = (await allPages([['display_category', 'パック'], ['name', core]], 2))
      .map(toPrice)
      .filter((p): p is CardRushPrice => !!p && p.name.includes(`『${core}』`));
    const pick = (variant: string) => rows.filter((p) => p.variant === variant).sort((a, b) => (better(a, b) ? -1 : 1))[0] ?? null;
    return { box: pick('未開封BOX'), pack: pick('未開封パック') };
  });
}
