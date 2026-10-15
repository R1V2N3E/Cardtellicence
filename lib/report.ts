import { cardrushSearchUrl, findCardrush } from './cardrush.js';
import { getFx } from './fx.js';
import { findPriceCharting } from './pricecharting.js';
import { mercariSearchUrl, searchMercari } from './mercari.js';
import { findSnkrdunkId, getSnkrdunk } from './snkrdunk.js';
import { cardmarketFor } from './prices.js';
import { cardmarketUrl, getCard } from './tcgdex.js';
import { cached, getJson } from './http.js';
import { findYuyutei, yuyuteiSearchUrl } from './yuyutei.js';
import { externalSnkId, getExternalCard, isExternalId } from './external.js';
import { englishName, germanName } from './pokedex.js';
import { sellLinks } from './selling.js';
import type { CardDetail, CardReport, OpportunityFile, SourceResult, YuyuteiPrice } from './types.js';

/**
 * Yuyu-tei blocks some cloud IP ranges (including Vercel's). The daily scan runs elsewhere,
 * so its stored price is the fallback when the live fetch fails.
 */
async function yuyuteiFromScan(origin: string | undefined, id: string): Promise<YuyuteiPrice | null> {
  if (!origin) return null;
  const file = await cached('scan-file', 10 * 60_000, () => getJson<OpportunityFile>(`${origin}/data/opportunities.json`));
  const o = file.items.find((i) => i.id === id);
  if (!o?.yytJpy || !o.yytUrl) return null;
  const m = o.yytUrl.match(/card\/([a-z0-9]+)\/(\d+)/);
  return {
    url: o.yytUrl,
    priceJpy: o.yytJpy,
    stock: o.yytStock,
    image: m ? `https://card.yuyu-tei.jp/poc/front/${m[1]}/${m[2]}.jpg` : null,
    asOf: o.yytAsOf ?? file.generatedAt,
  };
}

async function settle<T extends object>(p: Promise<T | null>, notFound: string, url?: string): Promise<SourceResult<T>> {
  try {
    const v = await p;
    return v ? { ok: true, ...v } : { ok: false, error: notFound, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), url };
  }
}

const PENDING = { ok: false as const, error: '', pending: true };

/** part 'core' answers fast with card data and Cardmarket prices only; the client loads the rest in parallel. */
export async function buildReport(id: string, origin?: string, part: 'all' | 'core' = 'all'): Promise<CardReport> {
  if (isExternalId(id)) return buildExternalReport(id);
  const [{ raw, detail }, fx] = await Promise.all([getCard(id), getFx()]);
  const cardmarket = await cardmarketFor(raw).catch(() => null);
  const { setId, number, nameJa, nameEn, localId } = detail;
  const jpQuery = `${nameJa} ${number}`;

  const links: Record<string, string> = {
    'Cardmarket': cardmarket?.url ?? cardmarketUrl(null, raw),
    'Yuyu-tei': yuyuteiSearchUrl(`${nameJa}`),
    'SNKRDUNK': `https://snkrdunk.com/search?keywords=${encodeURIComponent(`${setId} ${number}`)}`,
    'Mercari (sold)': mercariSearchUrl(jpQuery),
    'Card Rush': cardrushSearchUrl(`${nameJa} ${number}`),
    'PriceCharting': `https://www.pricecharting.com/search-products?q=${encodeURIComponent(`pokemon japanese ${nameEn ?? nameJa} ${Number(localId) || localId}`)}&type=prices`,
  };

  if (part === 'core') {
    return {
      card: detail,
      fx,
      links,
      cardmarket: cardmarket ? { ok: true, ...cardmarket } : { ok: false, error: 'No Cardmarket price guide entry', url: links.Cardmarket },
      cardrush: PENDING,
      yuyutei: PENDING,
      snkrdunk: PENDING,
      mercari: PENDING,
      pricecharting: PENDING,
      fetchedAt: new Date().toISOString(),
      partial: true,
      sell: { ...sellLinks(detail), nameDe: germanName(detail.nameJa, detail.dexId) },
    };
  }

  const [cardrush, yuyutei, snkrdunk, mercari, pricecharting] = await Promise.all([
    settle(findCardrush(setId, number), 'Nicht bei Card Rush gelistet', links['Card Rush']),
    settle(
      findYuyutei(setId, number)
        .then((r) => r && { url: r.url, priceJpy: r.priceJpy, stock: r.stock, image: r.image.replace('/100_140/', '/front/') })
        .catch(async (e) => {
          const fromScan = await yuyuteiFromScan(origin, id).catch(() => null);
          if (fromScan) return fromScan;
          throw e;
        }),
      'Not listed at Yuyu-tei',
      links['Yuyu-tei'],
    ),
    settle(
      findSnkrdunkId(setId, number).then((sid) => (sid ? getSnkrdunk(sid) : null)),
      'Not found on SNKRDUNK',
      links.SNKRDUNK,
    ),
    settle(searchMercari(jpQuery, [number.split('/')[0]]), 'No Mercari listings', links['Mercari (sold)']),
    settle(
      nameEn ? findPriceCharting(nameEn, localId).then((p) => p && (({ chart, ...rest }) => rest)(p)) : Promise.resolve(null),
      'No graded data on PriceCharting',
      links.PriceCharting,
    ),
  ]);

  if (cardrush.ok) links['Card Rush'] = cardrush.url;
  if (yuyutei.ok) links['Yuyu-tei'] = yuyutei.url;
  if (snkrdunk.ok) links.SNKRDUNK = snkrdunk.url;
  if (pricecharting.ok) links.PriceCharting = pricecharting.url;

  return {
    card: detail,
    fx,
    links,
    cardmarket: cardmarket ? { ok: true, ...cardmarket } : { ok: false, error: 'No Cardmarket price guide entry', url: links.Cardmarket },
    cardrush,
    yuyutei,
    snkrdunk,
    mercari,
    pricecharting,
    fetchedAt: new Date().toISOString(),
    sell: { ...sellLinks(detail), nameDe: germanName(detail.nameJa, detail.dexId) },
  };
}

/** Report for a card TCGdex doesn't list (deck/build-set products), based on SNKRDUNK. */
async function buildExternalReport(id: string): Promise<CardReport> {
  const [card, fx] = await Promise.all([getExternalCard(id), getFx()]);
  const nameEn = englishName(card.nameJa, []);
  const detail: CardDetail = { ...card, nameEn, illustrator: null, releaseDate: null, dexId: [] };
  const jpQuery = `${card.nameJa} ${card.number}`;
  const cmSearch = `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(nameEn ?? card.nameJa)}&language=7`;
  const links: Record<string, string> = {
    Cardmarket: cmSearch,
    SNKRDUNK: `https://snkrdunk.com/apparels/${externalSnkId(id)}`,
    'Yuyu-tei': yuyuteiSearchUrl(card.nameJa),
    'Mercari (sold)': mercariSearchUrl(jpQuery),
    'Card Rush': cardrushSearchUrl(jpQuery),
  };
  const [cardrush, snkrdunk, mercari, yuyutei] = await Promise.all([
    settle(findCardrush(card.setId, card.number), 'Nicht bei Card Rush gelistet', links['Card Rush']),
    settle(getSnkrdunk(externalSnkId(id)), 'Nicht auf SNKRDUNK gefunden', links.SNKRDUNK),
    settle(searchMercari(jpQuery, [card.number.split('/')[0]]), 'Keine Mercari-Angebote', links['Mercari (sold)']),
    settle(
      findYuyutei(card.setId, card.number).then((r) => r && { url: r.url, priceJpy: r.priceJpy, stock: r.stock, image: r.image.replace('/100_140/', '/front/') }),
      'Nicht bei Yuyu-tei gelistet',
      links['Yuyu-tei'],
    ),
  ]);
  return {
    card: detail,
    fx,
    links,
    cardmarket: { ok: false, error: 'Für dieses Produkt gibt es keine Cardmarket-Zuordnung – bitte manuell suchen', url: cmSearch },
    cardrush,
    yuyutei,
    snkrdunk,
    mercari,
    pricecharting: { ok: false, error: 'Nicht verfügbar für dieses Produkt' },
    fetchedAt: new Date().toISOString(),
    sell: { ...sellLinks(detail), nameDe: germanName(detail.nameJa, []) },
  };
}
