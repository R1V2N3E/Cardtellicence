// 遊々亭 (Yuyu-tei): large Japanese card shop with fixed sell prices and live stock.
// One set page lists every single of that set with price and stock, so we cache per set.
import { cached, decodeHtml, getText } from './http.js';

export interface YuyuteiRow {
  ver: string;
  cid: string;
  number: string; // "201/165"
  rarity: string;
  name: string;
  priceJpy: number;
  stock: number | null;
  url: string;
  image: string;
}

/** TCGdex set id -> Yuyu-tei set code: "SV2a" -> "sv02a", "M2" -> "m02", "S12a" -> "s12a". */
export function yuyuteiCode(setId: string): string {
  return setId.toLowerCase().replace(/^([a-z]+)(\d)(?!\d)/, '$10$2');
}

const CARD_RE =
  /<a\s+href="(https:\/\/yuyu-tei\.jp\/sell\/poc\/card\/([a-z0-9]+)\/(\d+))">\s*<div[^>]*product-img[^>]*>\s*<img\s+src="([^"]+)"\s+alt="([^"]*)"[\s\S]*?<strong\s+class="d-block text-end[^"]*">\s*([\d,]+)\s*円\s*<\/strong>[\s\S]*?在庫\s*:\s*([^<]*)</g;

export function parseYuyuteiList(html: string): YuyuteiRow[] {
  const rows: YuyuteiRow[] = [];
  for (const m of html.matchAll(CARD_RE)) {
    const [, url, ver, cid, image, alt, price, stockText] = m;
    const [number = '', rarity = '', ...rest] = decodeHtml(alt).split(/\s+/);
    const stockNum = stockText.match(/(\d+)/);
    rows.push({
      ver,
      cid,
      number,
      rarity,
      name: rest.join(' '),
      priceJpy: Number(price.replace(/,/g, '')),
      stock: stockText.includes('×') ? 0 : stockNum ? Number(stockNum[1]) : null,
      url,
      image,
    });
  }
  return rows;
}

// Full desktop-browser headers; Yuyu-tei rejects bare requests from some networks.
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
};

export function getYuyuteiSet(setId: string): Promise<YuyuteiRow[]> {
  const code = yuyuteiCode(setId);
  return cached(`yyt:${code}`, 2 * 3600_000, async () => {
    const html = await getText(`https://yuyu-tei.jp/sell/poc/s/${code}`, { headers: BROWSER_HEADERS });
    // Unknown codes render a different (default) set; only keep rows of the requested one.
    return parseYuyuteiList(html).filter((r) => r.ver === code);
  });
}

export const yuyuteiSearchUrl = (q: string) =>
  `https://yuyu-tei.jp/sell/poc/s/search?search_word=${encodeURIComponent(q)}`;

/** Find the cheapest in-stock (else cheapest) row for a card number within its set. */
export async function findYuyutei(setId: string, number: string) {
  const all = await getYuyuteiSet(setId);
  let rows = all.filter((r) => r.number === number);
  // Fall back to the card number alone when the printed total differs from our data.
  if (!rows.length) rows = all.filter((r) => r.number.split('/')[0] === number.split('/')[0]);
  if (!rows.length) return null;
  const inStock = rows.filter((r) => r.stock !== 0);
  return (inStock.length ? inStock : rows).sort((a, b) => a.priceJpy - b.priceJpy)[0];
}
