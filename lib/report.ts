import { getFx } from './fx.js';
import { findPriceCharting } from './pricecharting.js';
import { mercariSearchUrl, searchMercari } from './mercari.js';
import { findSnkrdunkId, getSnkrdunk } from './snkrdunk.js';
import { cardmarketFor } from './prices.js';
import { cardmarketUrl, getCard } from './tcgdex.js';
import { findYuyutei, yuyuteiSearchUrl } from './yuyutei.js';
import type { CardReport, SourceResult } from './types.js';

async function settle<T extends object>(p: Promise<T | null>, notFound: string, url?: string): Promise<SourceResult<T>> {
  try {
    const v = await p;
    return v ? { ok: true, ...v } : { ok: false, error: notFound, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), url };
  }
}

export async function buildReport(id: string): Promise<CardReport> {
  const [{ raw, detail }, fx] = await Promise.all([getCard(id), getFx()]);
  const cardmarket = await cardmarketFor(raw).catch(() => null);
  const { setId, number, nameJa, nameEn, localId } = detail;
  const jpQuery = `${nameJa} ${number}`;

  const links: Record<string, string> = {
    'Cardmarket': cardmarket?.url ?? cardmarketUrl(null, raw),
    'Yuyu-tei': yuyuteiSearchUrl(`${nameJa}`),
    'SNKRDUNK': `https://snkrdunk.com/search?keywords=${encodeURIComponent(`${setId} ${number}`)}`,
    'Mercari (sold)': mercariSearchUrl(jpQuery),
    'Card Rush': `https://www.cardrush-pokemon.jp/product-list?keyword=${encodeURIComponent(`${nameJa} ${number}`)}`,
    'PriceCharting': `https://www.pricecharting.com/search-products?q=${encodeURIComponent(`pokemon japanese ${nameEn ?? nameJa} ${Number(localId) || localId}`)}&type=prices`,
  };

  const [yuyutei, snkrdunk, mercari, pricecharting] = await Promise.all([
    settle(
      findYuyutei(setId, number).then(
        (r) => r && { url: r.url, priceJpy: r.priceJpy, stock: r.stock, image: r.image.replace('/100_140/', '/front/') },
      ),
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

  if (yuyutei.ok) links['Yuyu-tei'] = yuyutei.url;
  if (snkrdunk.ok) links.SNKRDUNK = snkrdunk.url;
  if (pricecharting.ok) links.PriceCharting = pricecharting.url;

  return {
    card: detail,
    fx,
    links,
    cardmarket: cardmarket ? { ok: true, ...cardmarket } : { ok: false, error: 'No Cardmarket price guide entry', url: links.Cardmarket },
    yuyutei,
    snkrdunk,
    mercari,
    pricecharting,
    fetchedAt: new Date().toISOString(),
  };
}
