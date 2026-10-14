// Web-standard request handlers shared by the Vercel functions (api/*.ts) and the Vite dev server.
import { getFx } from './fx.js';
import { findPriceCharting } from './pricecharting.js';
import { buildReport } from './report.js';
import { search } from './search.js';
import { getSnkrdunkChart, SNK_CONDITIONS, SNK_RANGES } from './snkrdunk.js';
import { getCard } from './tcgdex.js';

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
const CARD_ID = /^[A-Za-z0-9.-]{2,30}$/;

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
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!CARD_ID.test(id)) return fail('invalid card id', 400);
  try {
    return json(await buildReport(id), 900);
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
