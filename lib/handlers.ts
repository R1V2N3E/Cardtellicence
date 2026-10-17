// Web-standard request handlers shared by the Vercel functions (api/*.ts) and the Vite dev server.
import { cardrushSealed, cardrushSet, findCardrush, type CardRushPrice } from './cardrush.js';
import { officialPrices } from './cardmarket.js';
import { getFx } from './fx.js';
import { findPriceCharting } from './pricecharting.js';
import { buildReport } from './report.js';
import { search } from './search.js';
import { cached, dropCached, getJson, mapLimit } from './http.js';
import { identifyConfigured, matchReading, readCard, type IdentifyProgress } from './identify.js';
import { searchMercari } from './mercari.js';
import { getSnkrdunkSealedChart, packImage, sealedPrices } from './sealed.js';
import { externalSnkId, getExternalCard, isExternalId } from './external.js';
import { cardmarketFor } from './prices.js';
import { findSnkrdunk, getSnkrdunk, getSnkrdunkChart, SNK_CONDITIONS, SNK_RANGES } from './snkrdunk.js';
import { formatNumber, getCard, getRawCard, printedTotal } from './tcgdex.js';
import { paidLimits, rateLimit, requireAccess } from './security.js';
import { currentUsage, withUsage } from './usage.js';
import type { Opportunity, OpportunityFile, SealedItem } from './types.js';

function json(data: unknown, maxAge: number, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Cached at Vercel's edge; stale copies are served while refreshing in the background.
      'cache-control': status === 200 ? `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}` : 'no-store',
    },
  });
}

const fail = (e: unknown, status = 502) => json({ error: e instanceof Error ? e.message : String(e) }, 0, status);
const CARD_ID = /^[A-Za-z0-9.-]{2,30}$/; // TCGdex ids, "snk-<n>" (decks), "cm-<n>" (sealed)

export async function searchHandler(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  if (q.length > 60) return fail('query too long', 400);
  try {
    return json({ results: await search(q) }, 3600);
  } catch (e) {
    return fail(e);
  }
}

export async function cardHandler(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!CARD_ID.test(id)) return fail('invalid card id', 400);
  try {
    const part = url.searchParams.get('part') === 'core' ? 'core' : 'all';
    return json(await buildReport(id, url.origin, part), 900);
  } catch (e) {
    return fail(e, 404);
  }
}

/** Chart series: ?source=snkrdunk&id=128117&cond=raw|psa10|psa9&range=... or ?source=pricecharting&card=SV2a-201 */
export async function chartHandler(req: Request) {
  const p = new URL(req.url).searchParams;
  try {
    if (p.get('source') === 'snkrdunk') {
      const id = Number(p.get('id'));
      const cond = SNK_CONDITIONS[(p.get('cond') ?? 'raw') as keyof typeof SNK_CONDITIONS];
      const range = p.get('range') ?? 'threeMonths';
      if (!id || !cond || !(SNK_RANGES as readonly string[]).includes(range)) return fail('bad params', 400);
      return json({ points: await getSnkrdunkChart(id, cond, range) }, 3600);
    }
    if (p.get('source') === 'snkrdunk-sealed') {
      const id = Number(p.get('id'));
      const range = p.get('range') ?? 'threeMonths';
      if (!id || !(SNK_RANGES as readonly string[]).includes(range)) return fail('bad params', 400);
      return json({ points: await getSnkrdunkSealedChart(id, range) }, 3600);
    }
    if (p.get('source') === 'pricecharting') {
      const cardId = p.get('card') ?? '';
      if (!CARD_ID.test(cardId)) return fail('invalid card id', 400);
      const { detail } = await getCard(cardId);
      const page = detail.nameEn ? await findPriceCharting(detail.nameEn, detail.localId) : null;
      return json({ ungraded: page?.chart.ungraded ?? [], psa10: page?.chart.psa10 ?? [] }, 6 * 3600);
    }
    return fail('unknown source', 400);
  } catch (e) {
    return fail(e);
  }
}

export async function fxHandler() {
  try {
    return json(await getFx(), 3600);
  } catch (e) {
    return fail(e);
  }
}

const yyImg = (url: string, size: 'thumb' | 'high') => {
  const m = url.match(/card\/([a-z0-9]+)\/(\d+)/);
  return m ? `https://card.yuyu-tei.jp/poc/${size === 'high' ? 'front' : '200_280'}/${m[1]}/${m[2]}.jpg` : null;
};

/**
 * Best available picture for a card, as a redirect: TCGdex artwork, else the Yuyu-tei
 * scan stored by the daily scan, else SNKRDUNK's product photo. ?size=thumb|high
 * With ?set=<SET> instead: the photo of that set's booster pack.
 */
export async function imgHandler(req: Request) {
  const url = new URL(req.url);
  const setId = url.searchParams.get('set');
  if (setId != null) return packImgHandler(url, setId);
  const id = url.searchParams.get('id') ?? '';
  const size = url.searchParams.get('size') === 'high' ? 'high' : 'thumb';
  if (!CARD_ID.test(id)) return fail('invalid card id', 400);
  const resolve = () =>
    // Misses throw so they aren't cached; the CDN still caches the 404 for an hour.
    cached(`img:${id}:${size}`, 24 * 3600_000, async (): Promise<string> => {
      if (isExternalId(id)) {
        const ext = await getExternalCard(id);
        if (!ext.externalImage) throw new Error('no image');
        return ext.externalImage;
      }
      const raw = await getRawCard(id).catch(() => null);
      if (raw?.image) return `${raw.image}/${size === 'high' ? 'high' : 'low'}.webp`;
      const scan = await cached('scan-file', 10 * 60_000, () => getJson<OpportunityFile>(`${url.origin}/data/opportunities.json`)).catch(() => null);
      const o = scan?.items.find((i) => i.id === id);
      const fromShop = o?.yytUrl ? yyImg(o.yytUrl, size) : null;
      if (fromShop) return fromShop;
      if (o?.snkImg) return o.snkImg;
      if (!raw) throw new Error('unknown card');
      const number = formatNumber(raw.localId, printedTotal(raw.set.id, raw.set.cardCount?.official));
      const image = (await findSnkrdunk(raw.set.id, number).catch(() => null))?.image;
      if (!image) throw new Error('no image');
      return image;
    });
  const target = await resolve().catch(() => null);
  if (!target) return new Response('no image', { status: 404, headers: { 'cache-control': 'public, s-maxage=3600' } });
  return new Response(null, {
    status: 302,
    headers: { location: target, 'cache-control': 'public, max-age=86400, s-maxage=604800' },
  });
}

const redirect = (target: string | null) =>
  target
    ? new Response(null, { status: 302, headers: { location: target, 'cache-control': 'public, max-age=86400, s-maxage=604800' } })
    : new Response('no image', { status: 404, headers: { 'cache-control': 'public, s-maxage=3600' } });

async function packImgHandler(url: URL, setId: string) {
  if (!/^[A-Za-z0-9.-]{1,20}$/.test(setId)) return fail('invalid set id', 400);
  // The daily scan already knows the packs of recent sets.
  const scan = await cached('scan-file', 10 * 60_000, () => getJson<OpportunityFile>(`${url.origin}/data/opportunities.json`)).catch(() => null);
  const sealed = scan?.sealed?.filter((s) => s.setId.toLowerCase() === setId.toLowerCase() && s.image) ?? [];
  const known = sealed.find((s) => s.kind === 'pack') ?? sealed[0];
  return redirect(known?.image ?? (await packImage(setId).catch(() => null)));
}

/** POST {image: dataURL} → what Claude read on the card + matching Japanese cards. */
export async function identifyHandler(req: Request) {
  if (!identifyConfigured()) return json({ error: 'not_configured' }, 0, 501);
  // Shared secret so strangers can't spend the API budget, plus rate limits.
  const denied = (await requireAccess(req)) ?? (await paidLimits(req, 'identify'));
  if (denied) return denied;
  try {
    const body = (await req.json()) as { image?: string };
    const m = body.image?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return fail('image must be a base64 data URL', 400);
    if (m[2].length > 6_000_000) return fail('image too large', 413);
    const photo = { data: m[2], media: m[1] as 'image/jpeg' };
    // ?stream=1: one JSON line per step (reading → read → searching → candidates → verifying →
    // done), so the app can show what was read while the rest is still running.
    if (new URL(req.url).searchParams.get('stream') === '1') {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (e: IdentifyProgress) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
          try {
            await withUsage(async () => {
              send({ stage: 'reading' });
              const reading = await readCard(photo.data, photo.media);
              send({ stage: 'read', reading });
              const result = await matchReading(reading, photo, send);
              send({ stage: 'done', result: { ...result, usage: currentUsage() } });
            });
          } catch (e) {
            send({ stage: 'error', error: e instanceof Error ? e.message : String(e) });
          }
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
    }
    const { result, usage } = await withUsage(async () => matchReading(await readCard(photo.data, photo.media), photo));
    return json({ ...result, usage }, 0);
  } catch (e) {
    return fail(e);
  }
}

/** GET ?ids=SV2a-201,M2-110 → current Cardmarket prices (official price guide) per card. */
export async function pricesHandler(req: Request) {
  const origin = new URL(req.url).origin;
  // ?fresh=1 (refresh in the app): re-read Card Rush instead of using the 30-minute cache.
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  if (fresh) {
    const limited = await rateLimit(req, 'prices-fresh', 30, 600);
    if (limited) return limited;
    dropCached('cr:');
  }
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter((id) => CARD_ID.test(id)).slice(0, 150);
  try {
    const fx = await getFx().catch(() => null);
    const entries = await mapLimit(ids, 8, async (id) => {
      if (id.startsWith('cm-')) {
        // Card Rush lists sealed products by set name; the daily scan knows set and kind of each product.
        const scan = await cached('scan-file', 10 * 60_000, () => getJson<OpportunityFile>(`${origin}/data/opportunities.json`)).catch(() => null);
        const item = scan?.sealed?.find((s) => s.id === id);
        const [cm, crSealed] = await Promise.all([
          sealedPrices(id).catch(() => null),
          item ? cardrushSealed(item.setName).catch(() => null) : null,
        ]);
        const cr = crSealed && item ? crSealed[item.kind] : null;
        if (!cm && !cr) return [id, null] as const;
        return [
          id,
          { trend: cm?.trend ?? null, avg1: cm?.avg1 ?? null, avg7: cm?.avg7 ?? null, avg30: cm?.avg30 ?? null, low: cm?.low ?? null, updated: cm?.updated ?? null, source: 'cardmarket', cr: liveCr(cr) },
        ] as const;
      }
      if (isExternalId(id)) {
        const card = await getExternalCard(id).catch(() => null);
        const cr = card ? await findCardrush(card.setId, card.number).catch(() => null) : null;
        // No Cardmarket product: value at SNKRDUNK's recent sold price (else lowest ask), in EUR.
        const snk = await getSnkrdunk(externalSnkId(id)).catch(() => null);
        let jpy = snk?.rawMedianJpy ?? snk?.lowestAskJpy ?? null;
        if (jpy == null && !cr) {
          // Cheap deck cards often have no SNKRDUNK market: use Mercari's recent sold median.
          const merc = card ? await searchMercari(`${card.nameJa} ${card.number}`, [card.number.split('/')[0]]).catch(() => null) : null;
          jpy = merc?.soldMedianJpy ?? null;
        }
        const eur = jpy != null && fx ? Math.round(jpy * fx.jpyToEur * 100) / 100 : null;
        if (eur == null && !cr) return [id, null] as const;
        return [id, { trend: eur, avg1: null, avg7: null, avg30: null, low: null, updated: null, source: 'japan', cr: liveCr(cr) }] as const;
      }
      const raw = await getRawCard(id).catch(() => null);
      if (!raw) return [id, null] as const;
      const number = formatNumber(raw.localId, printedTotal(raw.set.id, raw.set.cardCount?.official));
      const [cm, cr] = await Promise.all([cardmarketFor(raw).catch(() => null), findCardrush(raw.set.id, number).catch(() => null)]);
      if (!cm && !cr) return [id, null] as const;
      return [
        id,
        {
          trend: cm?.trend ?? null,
          avg1: cm?.avg1 ?? null,
          avg7: cm?.avg7 ?? null,
          avg30: cm?.avg30 ?? null,
          low: cm?.low ?? null,
          updated: cm?.updated ?? null,
          source: 'cardmarket',
          cr: liveCr(cr),
        },
      ] as const;
    });
    return json({ prices: Object.fromEntries(entries), fetchedAt: new Date().toISOString() }, fresh ? 0 : 600);
  } catch (e) {
    return fail(e);
  }
}

/** The part of a Card Rush price the portfolio needs. */
const liveCr = (p: CardRushPrice | null) => p && { jpy: p.priceJpy, stock: p.stock, buyJpy: p.buyJpy, url: p.url, updatedAt: p.updatedAt };

/** Card Rush prices of one set (?set=SV2a), one card (&number=201/165), or a set's box/pack (?sealed=<set name>). */
export async function cardrushHandler(req: Request) {
  const url = new URL(req.url);
  const sealed = url.searchParams.get('sealed');
  if (sealed != null) {
    if (!sealed || sealed.length > 60) return fail('invalid set name', 400);
    return cardrushSealed(sealed).then((r) => json(r, 900), (e) => fail(e));
  }
  const set = url.searchParams.get('set') ?? '';
  const number = url.searchParams.get('number');
  if (!/^[A-Za-z0-9.-]{1,20}$/.test(set)) return fail('invalid set id', 400);
  try {
    const prices = await cardrushSet(set);
    if (number) return json({ price: prices.get(number) ?? null }, 900);
    return json({ prices: Object.fromEntries(prices) }, 900);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Push notifications:
 *   GET  ?action=key          → { configured, publicKey }
 *   POST ?action=subscribe    { subscription, prefs }  (also updates preferences)
 *   POST ?action=unsubscribe  { endpoint }
 *   POST ?action=check        send what is new (called by the scan and the hourly watch job)
 */
export async function pushHandler(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const push = await import('./push.js');
  if (!push.pushConfigured()) return json({ configured: false }, 0, action === 'key' ? 200 : 501);
  try {
    if (req.method === 'GET' && action === 'key') return json({ configured: true, publicKey: await push.publicKey() }, 0);
    if (req.method !== 'POST') return fail('method', 405);
    // Called by the scan jobs (no secret there): a few runs per hour for the whole app at most.
    if (action === 'check') return (await rateLimit(req, 'push-check', 6, 3600, false)) ?? json(await push.check(url.origin), 0);
    // Changing subscriptions needs the access code.
    const denied = (await requireAccess(req)) ?? (await rateLimit(req, 'push-sub', 20, 3600));
    if (denied) return denied;
    const body = await req.json().catch(() => null);
    if (action === 'subscribe' && body?.subscription?.endpoint && body?.prefs) {
      await push.subscribe(body.subscription, body.prefs, url.origin);
      return json({ ok: true }, 0);
    }
    if (action === 'unsubscribe' && body?.endpoint) {
      await push.unsubscribe(body.endpoint);
      return json({ ok: true }, 0);
    }
    return fail('bad request', 400);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Live re-pricing of the daily scan (refresh in the app): GET ?sets=SV2a,SM9 returns the current
 * Cardmarket price guide values and Card Rush prices for every scanned card and sealed product of
 * those sets. SNKRDUNK asks stay from the scan (its rate limit doesn't allow a full re-read).
 */
export async function liveHandler(req: Request) {
  const url = new URL(req.url);
  const sets = (url.searchParams.get('sets') ?? '').split(',').filter((s) => /^[A-Za-z0-9.+-]{1,20}$/.test(s)).slice(0, 12);
  if (!sets.length) return fail('sets required', 400);
  if (url.searchParams.get('fresh') === '1') {
    // A fresh read bypasses the cache and goes to Card Rush and Cardmarket: limit it per IP.
    const limited = await rateLimit(req, 'live-fresh', 40, 600);
    if (limited) return limited;
    dropCached('cr:');
  }
  try {
    const scan = await cached('scan-file', 5 * 60_000, () => getJson<OpportunityFile>(`${url.origin}/data/opportunities.json`));
    const wanted = new Set(sets);
    const items: Record<string, Partial<Opportunity>> = {};
    const sealed: Record<string, Partial<SealedItem>> = {};
    await mapLimit(sets, 4, async (setId) => {
      const cr = await cardrushSet(setId).catch(() => null);
      for (const o of scan.items.filter((i) => i.setId === setId)) {
        const cm = o.cmId ? await officialPrices(o.cmId, '').catch(() => null) : null;
        const rush = cr?.get(o.number);
        items[o.id] = {
          ...(cm && { cmTrend: cm.trend, cmAvg30: cm.avg30, cmAvg7: cm.avg7, cmLow: cm.low }),
          ...(cr && { crJpy: rush?.priceJpy ?? null, crStock: rush?.stock ?? null, crBuyJpy: rush?.buyJpy ?? null, crId: rush?.productId ?? null }),
        };
      }
      const products = (scan.sealed ?? []).filter((x) => x.setId === setId);
      if (!products.length) return;
      const rush = await cardrushSealed(products[0].setName).catch(() => null);
      for (const x of products) {
        const cm = await sealedPrices(x.id).catch(() => null);
        const p = rush?.[x.kind];
        sealed[x.id] = {
          ...(cm && { cmTrend: cm.trend, cmAvg30: cm.avg30, cmLow: cm.low }),
          ...(rush && { crJpy: p?.priceJpy ?? null, crStock: p?.stock ?? null, crBuyJpy: p?.buyJpy ?? null, crUrl: p?.url ?? null }),
        };
      }
    });
    return json({ items, sealed, sets: [...wanted], at: new Date().toISOString() }, url.searchParams.get('fresh') === '1' ? 0 : 300);
  } catch (e) {
    return fail(e);
  }
}
