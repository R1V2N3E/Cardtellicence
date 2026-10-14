// メルカリ (Mercari Japan): consumer marketplace. Sold listings give real "last sold"
// prices from private sellers. The web API requires a DPoP proof (ES256 JWT), which
// the official web client generates per request; we do the same with a throwaway key.
import crypto from 'node:crypto';
import { cached, median, request } from './http.js';
import type { MercariData, MercariItem } from './types.js';

const API = 'https://api.mercari.jp/v2/entities:search';

let keyPair: crypto.KeyPairKeyObjectResult | null = null;

function dpop(url: string, method: string): string {
  keyPair ??= crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = keyPair.publicKey.export({ format: 'jwk' });
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    htu: url,
    htm: method,
    uuid: crypto.randomUUID(),
  };
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: keyPair.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

// Listings that are graded, bundles or otherwise not a single raw copy.
const NOT_RAW = /PSA|BGS|ARS|CGC|鑑定|まとめ|セット|枚組|オリパ|BOX|ボックス|未開封|スリーブ|ローダー/i;

export const mercariSearchUrl = (q: string) =>
  `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=sold_out&order=desc&sort=created_time`;

interface RawItem {
  id: string;
  name: string;
  price: string;
  status: string;
  updated: string;
  thumbnails?: string[];
}

export function searchMercari(keyword: string, mustInclude: string[]): Promise<MercariData> {
  return cached(`mercari:${keyword}`, 60 * 60_000, async () => {
    const body = {
      pageSize: 60,
      searchSessionId: crypto.randomUUID().replace(/-/g, ''),
      indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
      thumbnailTypes: [],
      searchCondition: {
        keyword,
        excludeKeyword: '',
        sort: 'SORT_CREATED_TIME',
        order: 'ORDER_DESC',
        status: ['STATUS_ON_SALE', 'STATUS_SOLD_OUT', 'STATUS_TRADING'],
        sizeId: [], categoryId: [], brandId: [], sellerId: [], priceMin: 0, priceMax: 0,
        itemConditionId: [], shippingPayerId: [], shippingFromArea: [], shippingMethod: [],
        colorId: [], hasCoupon: false, attributes: [], itemTypes: [], skuIds: [],
      },
      defaultDatasets: ['DATASET_TYPE_MERCARI', 'DATASET_TYPE_BEYOND'],
      serviceFrom: 'suruga',
      withItemBrand: true,
      withItemSize: false,
      withItemPromotions: true,
      withItemSizes: true,
      withShopname: false,
    };
    const res = await request(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-platform': 'web', dpop: dpop(API, 'POST') },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { items?: RawItem[] };
    const items: MercariItem[] = (json.items ?? [])
      .filter((it) => mustInclude.every((s) => it.name.toLowerCase().includes(s.toLowerCase())))
      .filter((it) => !NOT_RAW.test(it.name))
      .map((it) => ({
        id: it.id,
        name: it.name,
        priceJpy: Number(it.price),
        sold: it.status !== 'ITEM_STATUS_ON_SALE',
        updated: new Date(Number(it.updated) * 1000).toISOString(),
        thumb: it.thumbnails?.[0] ?? null,
        url: `https://jp.mercari.com/item/${it.id}`,
      }));
    const sold = items.filter((i) => i.sold);
    const soldMedianJpy = median(sold.slice(0, 20).map((i) => i.priceJpy));
    // Placeholder listings ("専用", ¥300 reservations) would fake a cheap buy price.
    const floor = soldMedianJpy ? soldMedianJpy * 0.4 : 0;
    const active = items.filter((i) => !i.sold && i.priceJpy >= floor).map((i) => i.priceJpy);
    return {
      url: mercariSearchUrl(keyword),
      items,
      soldMedianJpy,
      soldCount: sold.length,
      activeLowestJpy: active.length ? Math.min(...active) : null,
    };
  });
}
