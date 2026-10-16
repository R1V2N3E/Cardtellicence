// The agent's tools, run on the device: market data from the daily scan, live prices from the
// app's API, the user's collection, settings and sales. Results are compact JSON for Claude.
import type { AgentToolName } from '../../lib/agentTools';
import type { CardReport, Opportunity, OpportunityFile, SealedItem } from '../../lib/types';
import { api, loadOpportunities, type LivePrice } from '../api';
import { sealedMargin } from '../components/SealedSheet';
import { buildMarket, ERAS, indexSeries, jpPremium, laggards, movers, seriesChange, type CardStat, type MarketView } from '../market';
import { CHANNEL, computeMargin, costModel, opportunityMargin, pickBuy, reportBuyOptions, reportSell, reverseMargin, type BuyOption } from '../margin';
import { addCollectionItem, readList, readSettings, readWatchlist, write, type CollectionItem, type Condition, type WatchItem } from '../state';
import { addSale, boughtAt, daysUntil, FREIGRENZE_EUR, readSales, taxFreeFrom, yearTax } from '../tax';
import { requestConfirmation } from './confirm';
import { addAlert, addMemory } from './store';

type Input = Record<string, unknown>;

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const int = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Math.round(num(v) ?? def)));
const today = () => new Date().toISOString().slice(0, 10);

// Played copies sell below the near-mint Cardmarket trend.
export const CONDITION_FACTOR: Record<Condition, number> = { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, PSA10: 1, PSA9: 1 };

// ---------- shared data ----------

let viewCache: { data: OpportunityFile; view: MarketView } | null = null;
async function market() {
  const data = await loadOpportunities();
  if (viewCache?.data !== data) viewCache = { data, view: buildMarket(data.items, data.sets, data.fx.jpyToEur) };
  return viewCache;
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s・･\-_]/g, '');

function cardLine(o: Opportunity, view?: MarketView) {
  const stat = view?.cards.find((c) => c.o.id === o.id);
  return {
    id: o.id,
    name: o.nameEn ?? o.nameJa,
    name_ja: o.nameJa,
    set: `${o.setId} ${o.setName}`,
    number: o.number,
    rarity: o.rarity,
    cm_trend_eur: r2(o.cmTrend),
    cm_avg30_eur: r2(o.cmAvg30),
    card_rush_sell_jpy: o.crJpy ?? null,
    card_rush_stock: o.crStock ?? null,
    card_rush_buyback_jpy: o.crBuyJpy ?? null,
    momentum_pct: pct(stat?.mom30),
    jp_premium: stat?.jpPremium != null ? r2(stat.jpPremium) : null,
  };
}

const sealedLine = (s: SealedItem) => ({
  id: s.id,
  name: s.nameEn,
  kind: s.kind,
  set: `${s.setId} ${s.setName}`,
  cm_trend_eur: r2(s.cmTrend),
  card_rush_sell_jpy: s.crJpy ?? null,
  card_rush_stock: s.crStock ?? null,
  snkrdunk_ask_jpy: s.snkAskJpy,
});

/** A card's basic data from the scan, else from the live card report. */
async function findCard(id: string): Promise<{ o?: Opportunity; s?: SealedItem; summary: { id: string; nameJa: string; nameEn: string | null; setId: string; setName: string; number: string; rarity: string | null; image: string | null } }> {
  const { data } = await market();
  const o = data.items.find((x) => x.id === id);
  if (o) return { o, summary: o };
  const s = data.sealed?.find((x) => x.id === id);
  if (s) return { s, summary: { id: s.id, nameJa: s.setName, nameEn: s.nameEn, setId: s.setId, setName: s.setName, number: s.kind === 'box' ? 'Display' : 'Booster', rarity: null, image: s.image } };
  const r = await api.card(id);
  return { summary: r.card };
}

// ---------- tools ----------

async function searchCards(i: Input) {
  const q = str(i.query) ?? '';
  const setId = str(i.set_id)?.toLowerCase();
  const limit = int(i.limit, 10, 40);
  const { data, view } = await market();
  const tokens = q.split(/\s+/).map(norm).filter(Boolean);
  const hay = (o: Opportunity) => norm([o.id, o.nameJa, o.nameEn, o.setId, o.setName, o.number, o.rarity].filter(Boolean).join(' '));
  let hits = data.items.filter((o) => (!setId || o.setId.toLowerCase() === setId) && tokens.every((t) => hay(o).includes(t)));
  if (num(i.max_eur) != null) hits = hits.filter((o) => (o.cmTrend ?? Infinity) <= num(i.max_eur)!);
  if (num(i.min_eur) != null) hits = hits.filter((o) => (o.cmTrend ?? 0) >= num(i.min_eur)!);
  const settings = readSettings();
  const stat = new Map(view.cards.map((c) => [c.o.id, c]));
  const key: Record<string, (o: Opportunity) => number> = {
    value: (o) => o.cmTrend ?? 0,
    momentum: (o) => stat.get(o.id)?.mom30 ?? -9,
    margin: (o) => opportunityMargin(o, settings, data.fx.jpyToEur).marginEur ?? -1e9,
    jp_premium: (o) => stat.get(o.id)?.jpPremium ?? 0,
  };
  const k = key[str(i.sort) ?? 'value'] ?? key.value;
  hits.sort((a, b) => k(b) - k(a));
  const sealed = (data.sealed ?? []).filter((s) => tokens.every((t) => norm(`${s.id} ${s.nameEn} ${s.setId} ${s.setName} ${s.kind === 'box' ? 'box display' : 'booster pack'}`).includes(t))).slice(0, 6);
  // Cards outside the daily scan (cheap commons, promos): from the card search, without prices.
  let more: unknown[] = [];
  if (hits.length < limit && q) {
    const found = await api.search(q).catch(() => []);
    const known = new Set(hits.map((h) => h.id));
    more = found
      .filter((c) => !known.has(c.id) && (!setId || c.setId.toLowerCase() === setId))
      .slice(0, limit - hits.length)
      .map((c) => ({ id: c.id, name: c.nameEn ?? c.nameJa, name_ja: c.nameJa, set: `${c.setId} ${c.setName}`, number: c.number, rarity: c.rarity, note: 'nicht im täglichen Scan – Preise über card_details' }));
  }
  return {
    cards: hits.slice(0, limit).map((o) => cardLine(o, view)),
    other_cards: more,
    sealed: sealed.map(sealedLine),
    total_matches: hits.length,
    fx_jpy_to_eur: data.fx.jpyToEur,
  };
}

function compactReport(r: CardReport) {
  const cm = r.cardmarket.ok ? r.cardmarket : null;
  const cr = r.cardrush.ok ? r.cardrush : null;
  const snk = r.snkrdunk.ok ? r.snkrdunk : null;
  const yyt = r.yuyutei.ok ? r.yuyutei : null;
  const mer = r.mercari.ok ? r.mercari : null;
  const pc = r.pricecharting.ok ? r.pricecharting : null;
  return {
    card: { id: r.card.id, name: r.card.nameEn ?? r.card.nameJa, name_ja: r.card.nameJa, set: `${r.card.setId} ${r.card.setName}`, number: r.card.number, rarity: r.card.rarity, illustrator: r.card.illustrator, release: r.card.releaseDate },
    cardmarket: cm && { trend_eur: cm.trend, avg1_eur: cm.avg1, avg7_eur: cm.avg7, avg30_eur: cm.avg30, lowest_offer_eur: cm.low, url: cm.url },
    card_rush: cr && { sell_jpy: cr.priceJpy, stock: cr.stock, buyback_jpy: cr.buyJpy, updated: cr.updatedAt, url: cr.url },
    snkrdunk: snk && { lowest_ask_jpy: snk.lowestAskJpy, listings: snk.listingCount, recent_raw_median_jpy: snk.rawMedianJpy, psa10_median_jpy: snk.psa10MedianJpy, psa9_median_jpy: snk.psa9MedianJpy },
    yuyutei: yyt && { sell_jpy: yyt.priceJpy, stock: yyt.stock, as_of: yyt.asOf ?? 'live' },
    mercari: mer && { lowest_listing_jpy: mer.activeLowestJpy, sold_median_jpy: mer.soldMedianJpy, sold_count: mer.soldCount },
    pricecharting_usd: pc && { ungraded: pc.ungradedUsd, psa9: pc.grade9Usd, psa10: pc.psa10Usd },
    fx_jpy_to_eur: r.fx.jpyToEur,
  };
}

async function cardDetails(i: Input) {
  const id = str(i.id);
  if (!id) throw new Error('id fehlt');
  const s = readSettings();
  const { data } = await market();
  const sealed = data.sealed?.find((x) => x.id === id);
  if (sealed) {
    const m = sealedMargin(sealed, s, data.fx);
    return { sealed: sealedLine(sealed), jp_to_de: marginJson(m) };
  }
  const [r, hist] = await Promise.all([api.card(id), api.history(id.split('-')[0]).catch(() => ({}))]);
  const fx = r.fx.jpyToEur;
  const buy = pickBuy(reportBuyOptions(r, s.includeSoldOut), s.buySource, true);
  const sell = reportSell(r, s.sellRef);
  const rev = r.cardmarket.ok && r.cardrush.ok ? reverseMargin({ cmTrend: r.cardmarket.trend, cmAvg30: r.cardmarket.avg30, cmLow: r.cardmarket.low, crBuyJpy: r.cardrush.buyJpy }, s, fx) : null;
  const rows = (hist as Record<string, [string, number | null, number | null, number | null, (number | null)?, (number | null)?][]>)[id] ?? [];
  const owned = readList<CollectionItem>('ct-collection').filter((c) => c.cardId === id);
  return {
    ...compactReport(r),
    jp_to_de: { ...marginJson(computeMargin(buy, sell.eur, fx, costModel(s))), sell_basis: sell.note ?? s.sellRef },
    de_to_jp_buyback: rev && { buy_eur: r2(rev.buyEur), shipping_eur: r2(rev.shipEur), jp_import_tax_eur: r2(rev.taxEur), payout_eur: r2(rev.payoutEur), margin_eur: r2(rev.marginEur), roi_pct: pct(rev.roi) },
    history_daily: rows.slice(-30).map(([d, trend, avg30, , crJpy, crBuy]) => ({ d, trend, avg30, cr_jpy: crJpy ?? null, cr_buy_jpy: crBuy ?? null })),
    owned: owned.map((c) => ({ qty: c.qty, condition: c.condition, cost: c.cost, bought: boughtAt(c) })),
    on_watchlist: readWatchlist().some((w) => w.id === id),
  };
}

function marginJson(m: ReturnType<typeof computeMargin>) {
  return {
    buy: m.buy && { shop: m.buy.label, jpy: m.buy.jpy, note: m.buy.note ?? null },
    buy_eur: r2(m.buyEur),
    landed_cost_eur: r2(m.landedEur),
    costs_eur: m.costs && { proxy: r2(m.costs.proxy), shipping: r2(m.costs.ship), duty: r2(m.costs.duty), import_vat: r2(m.costs.vat), selling_fee: r2(m.costs.sellFee) },
    sell_eur: r2(m.sellEur),
    proceeds_eur: r2(m.proceedsEur),
    net_margin_eur: r2(m.marginEur),
    roi_pct: pct(m.roi),
  };
}

function settingsSummary() {
  const s = readSettings();
  return {
    net: s.net,
    costs_on: s.costOn,
    proxy_pct: s.proxyPct,
    shipping_eur: s.shipEur,
    shipping_sealed_eur: s.shipSealedEur,
    duty_pct: s.dutyPct,
    import_vat_pct: s.vatPct,
    sell_channel: CHANNEL[s.sellChannel].label,
    sell_price_basis: s.sellRef,
  };
}

async function computeMarginTool(i: Input) {
  const s = readSettings();
  const { data } = await market();
  const fx = data.fx.jpyToEur;
  const id = str(i.card_id);
  const card = id ? await findCard(id).catch(() => null) : null;
  let jpy = num(i.buy_jpy) ?? (num(i.buy_eur) != null ? num(i.buy_eur)! / fx : undefined);
  let sell = num(i.sell_eur);
  if (card?.o) {
    jpy ??= card.o.crJpy ?? card.o.yytJpy ?? card.o.snkAskJpy ?? undefined;
    sell ??= card.o.cmTrend ?? undefined;
  } else if (card?.s) {
    jpy ??= card.s.crJpy ?? card.s.snkAskJpy ?? undefined;
    sell ??= card.s.cmTrend ?? undefined;
  }
  if (jpy == null) throw new Error('Kein Kaufpreis bekannt – buy_jpy oder buy_eur angeben');
  const buy: BuyOption = { source: 'cardrush', label: num(i.buy_jpy) != null || num(i.buy_eur) != null ? 'Angegebener Preis' : 'Card Rush', jpy: Math.round(jpy) };
  const m = computeMargin(buy, sell ?? null, fx, costModel(s, Boolean(i.sealed) || Boolean(card?.s)));
  return { ...marginJson(m), break_even_buy_jpy: breakEven(sell ?? null, s, fx, Boolean(i.sealed) || Boolean(card?.s)), cost_settings: settingsSummary(), fx_jpy_to_eur: fx };
}

/** Highest Japanese price at which the trade still breaks even. */
function breakEven(sellEur: number | null, s: ReturnType<typeof readSettings>, fx: number, sealed: boolean) {
  if (sellEur == null) return null;
  const c = costModel(s, sealed);
  let lo = 0;
  let hi = (sellEur / fx) * 2;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const m = computeMargin({ source: 'cardrush', label: '', jpy: mid }, sellEur, fx, c);
    if ((m.marginEur ?? -1) >= 0) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 10) * 10;
}

const setLine = (s: MarketView['sets'][number], daily?: number | null) => ({
  set: s.key,
  name: s.name,
  era: ERAS.find((e) => e.key === s.era)?.label,
  value_eur: Math.round(s.value),
  cards: s.cards,
  momentum_pct: pct(s.change30),
  daily_index_change_pct: pct(daily),
  jp_value_eur: Math.round(s.jpValue),
  top_card: s.top && `${s.top.o.nameEn ?? s.top.o.nameJa} ${s.top.o.number} (${r2(s.top.value)} €)`,
});
const statLine = (c: CardStat) => ({
  id: c.o.id,
  name: c.o.nameEn ?? c.o.nameJa,
  set: c.o.setId,
  number: c.o.number,
  value_eur: r2(c.value),
  avg30_eur: r2(c.o.cmAvg30),
  avg7_eur: r2(c.o.cmAvg7),
  momentum_pct: pct(c.mom30),
  card_rush_eur: r2(c.jpEur),
  jp_premium: r2(c.jpPremium),
});

async function marketOverview(i: Input) {
  const { view } = await market();
  const mk = await api.market();
  const setId = str(i.set_id);
  if (setId) {
    const set = view.sets.find((s) => s.key.toLowerCase() === setId.toLowerCase());
    if (!set) return { error: `Set ${setId} ist nicht im täglichen Scan` };
    const cards = view.bySet.get(set.key) ?? [];
    const series = indexSeries(mk, [set.key]);
    return {
      ...setLine(set, seriesChange(series)),
      rank_by_value: [...view.sets].sort((a, b) => b.value - a.value).findIndex((s) => s.key === set.key) + 1,
      of_sets: view.sets.length,
      daily_values: series.map((p) => ({ d: new Date(p.t).toISOString().slice(0, 10), eur: Math.round(p.v) })),
      top_cards: [...cards].sort((a, b) => b.value - a.value).slice(0, 10).map(statLine),
      risers: cards.filter((c) => c.value >= 3 && (c.mom30 ?? 0) > 0).sort((a, b) => b.mom30! - a.mom30!).slice(0, 5).map(statLine),
      fallers: cards.filter((c) => c.value >= 3 && (c.mom30 ?? 0) < 0).sort((a, b) => a.mom30! - b.mom30!).slice(0, 5).map(statLine),
      laggards: laggards(view).filter((x) => x.c.o.setId === set.key).slice(0, 8).map((x) => statLine(x.c)),
    };
  }
  const era = str(i.era);
  const sets = view.sets.filter((s) => !era || s.era === era);
  const daily = new Map(sets.map((s) => [s.key, seriesChange(indexSeries(mk, [s.key]))]));
  const withMom = sets.filter((s) => s.change30 != null);
  return {
    total: { value_eur: Math.round(view.total.value), cards: view.total.cards, momentum_pct: pct(view.total.change30), daily_index_change_pct: pct(seriesChange(indexSeries(mk, null))), days_of_index: Object.keys(mk?.days ?? {}).length },
    generations: view.eras.map((e) => ({ era: e.name, value_eur: Math.round(e.value), cards: e.cards, momentum_pct: pct(e.change30), share_pct: pct(e.value / view.total.value) })),
    top_sets_by_value: [...sets].sort((a, b) => b.value - a.value).slice(0, 12).map((s) => setLine(s, daily.get(s.key))),
    strongest_momentum: [...withMom].sort((a, b) => b.change30! - a.change30!).slice(0, 6).map((s) => setLine(s, daily.get(s.key))),
    weakest_momentum: [...withMom].sort((a, b) => a.change30! - b.change30!).slice(0, 6).map((s) => setLine(s, daily.get(s.key))),
    note: 'Momentum = Ø 7 Tage / Ø 30 Tage − 1 (wertgewichteter Median). Der tägliche Index ist erst wenige Tage alt.',
  };
}

async function findOpportunities(i: Input) {
  const kind = str(i.kind) ?? 'deals';
  const { data, view } = await market();
  const s = readSettings();
  const fx = data.fx.jpyToEur;
  const limit = int(i.limit, 10, 30);
  const setId = str(i.set_id)?.toLowerCase();
  const minEur = num(i.min_eur) ?? 5;
  const budget = num(i.budget_eur);
  const inSet = (id: string) => !setId || id.toLowerCase() === setId;

  if (kind === 'deals') {
    const rows = data.items
      .filter((o) => inSet(o.setId) && (o.cmTrend ?? 0) >= minEur)
      .map((o) => ({ o, m: opportunityMargin(o, s, fx) }))
      .filter((x) => x.m.buy && (x.m.marginEur ?? 0) > 0 && (budget == null || (x.m.landedEur ?? Infinity) <= budget))
      .sort((a, b) => b.m.marginEur! - a.m.marginEur!)
      .slice(0, limit);
    return { kind, cost_settings: settingsSummary(), scan_from: data.generatedAt, results: rows.map(({ o, m }) => ({ ...cardLine(o, view), ...marginJson(m) })) };
  }
  if (kind === 'reverse') {
    const rows = data.items
      .filter((o) => inSet(o.setId) && (o.cmTrend ?? 0) >= minEur)
      .map((o) => ({ o, r: reverseMargin(o, s, fx) }))
      .filter((x) => x.r && x.r.marginEur > 0 && (budget == null || x.r.costEur <= budget))
      .sort((a, b) => b.r!.marginEur - a.r!.marginEur)
      .slice(0, limit);
    return { kind, scan_from: data.generatedAt, results: rows.map(({ o, r }) => ({ ...cardLine(o, view), buy_cardmarket_eur: r2(r!.buyEur), cost_eur: r2(r!.costEur), card_rush_payout_eur: r2(r!.payoutEur), margin_eur: r2(r!.marginEur), roi_pct: pct(r!.roi) })) };
  }
  if (kind === 'sealed') {
    const rows = (data.sealed ?? [])
      .filter((x) => inSet(x.setId))
      .map((x) => ({ x, m: sealedMargin(x, s, data.fx) }))
      .filter((r) => r.m.buy && (budget == null || (r.m.landedEur ?? Infinity) <= budget))
      .sort((a, b) => (b.m.marginEur ?? -1e9) - (a.m.marginEur ?? -1e9))
      .slice(0, limit);
    return { kind, results: rows.map(({ x, m }) => ({ ...sealedLine(x), ...marginJson(m), sell_note: m.sellNote ?? null })) };
  }
  const pick = (list: CardStat[]) => list.filter((c) => inSet(c.o.setId) && c.value >= minEur).slice(0, limit).map(statLine);
  if (kind === 'laggards')
    return {
      kind,
      explanation: 'Set-Momentum ≥ +5 %, Karte mindestens 10 Punkte darunter (aber nicht abgestürzt).',
      results: laggards(view, minEur)
        .filter((x) => inSet(x.c.o.setId))
        .slice(0, limit)
        .map((x) => ({ ...statLine(x.c), set_momentum_pct: pct(x.set.change30) })),
    };
  if (kind === 'jp_premium') return { kind, explanation: 'Card Rush (€) / Cardmarket-Trend ≥ 1,4', results: pick(jpPremium(view, minEur)) };
  if (kind === 'gainers') return { kind, results: pick(movers(view, 1, minEur)) };
  if (kind === 'losers') return { kind, results: pick(movers(view, -1, minEur)) };
  throw new Error(`Unbekannte Art: ${kind}`);
}

async function livePrices(ids: string[]): Promise<Record<string, LivePrice | null>> {
  const chunks: string[][] = [];
  for (let k = 0; k < ids.length; k += 100) chunks.push(ids.slice(k, k + 100));
  const res = await Promise.all(chunks.map((c) => api.prices(c).catch(() => null)));
  return Object.assign({}, ...res.map((r) => r?.prices ?? {}));
}

async function portfolioTool(i: Input) {
  const items = readList<CollectionItem>('ct-collection').filter((c) => !str(i.set_id) || c.setId.toLowerCase() === str(i.set_id)!.toLowerCase());
  if (!items.length) return { items: [], note: 'Die Sammlung ist leer.' };
  const { data } = await market();
  const fx = data.fx.jpyToEur;
  const s = readSettings();
  const prices = await livePrices([...new Set(items.map((c) => c.cardId))]);
  let total = 0;
  let totalCost = 0;
  let unpriced = 0;
  const rows = items.map((c) => {
    const p = prices[c.cardId];
    const cmEach = p?.trend != null ? p.trend * CONDITION_FACTOR[c.condition] : null;
    const crEach = s.valuation === 'cardrushBuy' ? p?.cr?.buyJpy : p?.cr?.jpy;
    const each = s.valuation !== 'cardmarket' && crEach ? crEach * fx : cmEach;
    const costEach = c.cost ? (c.cost.currency === 'EUR' ? c.cost.amount : c.cost.amount * fx) : null;
    if (each == null) unpriced++;
    total += (each ?? 0) * c.qty;
    if (costEach != null) totalCost += costEach * c.qty;
    const bought = boughtAt(c);
    const free = taxFreeFrom(bought);
    return {
      id: c.cardId,
      name: c.nameEn ?? c.nameJa,
      set: c.setId,
      number: c.number,
      kind: c.kind ?? 'card',
      qty: c.qty,
      condition: c.condition,
      value_each_eur: r2(each),
      cardmarket_trend_each_eur: r2(cmEach),
      card_rush_sell_jpy: p?.cr?.jpy ?? null,
      card_rush_buyback_jpy: p?.cr?.buyJpy ?? null,
      cost_each_eur: r2(costEach),
      gain_eur: each != null && costEach != null ? r2((each - costEach) * c.qty) : null,
      bought,
      tax_free_from: free,
      tax_free_now: free <= today(),
    };
  });
  rows.sort((a, b) => (b.value_each_eur ?? 0) * b.qty - (a.value_each_eur ?? 0) * a.qty);
  return {
    valuation: s.valuation === 'cardmarket' ? 'Cardmarket-Trend (nach Zustand)' : s.valuation === 'cardrushBuy' ? 'Card-Rush-Ankauf' : 'Card-Rush-Verkaufspreis',
    total_value_eur: Math.round(total),
    total_cost_eur_known: Math.round(totalCost),
    items_without_price: unpriced,
    items: rows.slice(0, 80),
    more_items: Math.max(0, rows.length - 80),
    sales_recorded: readSales().length,
  };
}

async function sellOptions(i: Input) {
  const id = str(i.id);
  if (!id) throw new Error('id fehlt');
  const cond = (str(i.condition) as Condition | undefined) ?? 'NM';
  const qty = int(i.qty, 1, 999);
  const s = readSettings();
  const r = await api.card(id);
  const fx = r.fx.jpyToEur;
  const cm = r.cardmarket.ok ? r.cardmarket : null;
  const graded = cond === 'PSA10' || cond === 'PSA9';
  const snk = r.snkrdunk.ok ? r.snkrdunk : null;
  const gradedJpy = cond === 'PSA10' ? snk?.psa10MedianJpy : cond === 'PSA9' ? snk?.psa9MedianJpy : null;
  const base = graded ? (gradedJpy ? gradedJpy * fx : null) : cm?.trend != null ? cm.trend * CONDITION_FACTOR[cond] : null;
  const quick = graded ? base : cm ? Math.min(cm.low ?? Infinity, cm.trend ?? Infinity) * CONDITION_FACTOR[cond] : null;
  const ch = (label: string, price: number | null, feePct: number, extra: string) =>
    price == null || !Number.isFinite(price) ? null : { channel: label, price_each_eur: r2(price), fee_pct: feePct, net_each_eur: r2(price * (1 - feePct / 100)), note: extra };
  const cr = r.cardrush.ok ? r.cardrush : null;
  const revShip = s.net && s.costOn.revShip ? s.revShipEur : 0;
  const channels = [
    ch('Cardmarket – bester Preis (Trend)', base, CHANNEL.cardmarket.feePct, graded ? 'gegradet: Preis aus SNKRDUNK-Verkäufen' : 'Verkauf dauert länger'),
    ch('Cardmarket – schneller Verkauf', quick, CHANNEL.cardmarket.feePct, 'unter/auf günstigstem Angebot'),
    ch('eBay privat', base, CHANNEL.ebay.feePct, 'keine Verkaufsgebühr für Privatverkäufer; Käufer zahlt meist Versand'),
    ch('Kleinanzeigen', base != null ? base * 0.92 : null, 0, 'Verhandlungsspielraum ~8 % einrechnen'),
    cr?.buyJpy && !graded ? { channel: 'Card Rush Ankauf (Japan)', price_each_eur: r2(cr.buyJpy * fx), fee_pct: 0, net_each_eur: r2(cr.buyJpy * fx - revShip), note: `abzgl. Versand nach Japan ${revShip} € – bei Japanreise ohne Versand` } : null,
  ].filter(Boolean) as { channel: string; net_each_eur: number | null }[];
  channels.sort((a, b) => (b.net_each_eur ?? 0) - (a.net_each_eur ?? 0));

  const owned = readList<CollectionItem>('ct-collection').filter((c) => c.cardId === id);
  const best = channels[0]?.net_each_eur ?? null;
  const yt = yearTax(readSales());
  const ownedInfo = owned.map((c) => {
    const costEach = c.cost ? (c.cost.currency === 'EUR' ? c.cost.amount : c.cost.amount * fx) : null;
    const bought = boughtAt(c);
    const free = taxFreeFrom(bought);
    const gain = best != null && costEach != null ? (best - costEach) * Math.min(qty, c.qty) : null;
    return {
      qty: c.qty,
      condition: c.condition,
      cost_each_eur: r2(costEach),
      bought,
      tax_free_from: free,
      tax_free_now: free <= today(),
      days_until_tax_free: free > today() ? daysUntil(free) : 0,
      gain_if_sold_now_best_channel_eur: r2(gain),
      year_taxable_gains_after_sale_eur: free > today() && gain != null ? r2(yt.taxableGain + gain) : null,
    };
  });
  return {
    card: compactReport(r).card,
    condition: cond,
    qty,
    channels,
    owned: ownedInfo,
    tax_year: { taxable_gains_so_far_eur: r2(yt.taxableGain), freigrenze_eur: FREIGRENZE_EUR, remaining_eur: r2(yt.remaining) },
    market: compactReport(r).cardmarket,
  };
}

async function taxOverview(i: Input) {
  const year = num(i.year) ?? new Date().getFullYear();
  const yt = yearTax(readSales(), year);
  const items = readList<CollectionItem>('ct-collection');
  const soon = items
    .map((c) => ({ c, free: taxFreeFrom(boughtAt(c)) }))
    .filter((x) => x.free > today())
    .sort((a, b) => a.free.localeCompare(b.free))
    .slice(0, 15)
    .map(({ c, free }) => ({ id: c.cardId, name: c.nameEn ?? c.nameJa, qty: c.qty, bought: boughtAt(c), tax_free_from: free, days: daysUntil(free) }));
  return {
    year,
    rule: 'Privat: Gewinn steuerfrei nach > 1 Jahr Haltedauer; sonst Freigrenze 1.000 € Gesamtgewinn pro Jahr (bei Erreichen alles steuerpflichtig). Verluste aus Spekulationsgeschäften werden verrechnet.',
    taxable_gains_eur: r2(yt.taxableGain),
    tax_free_gains_eur: r2(yt.taxFreeGain),
    freigrenze_eur: FREIGRENZE_EUR,
    remaining_until_limit_eur: r2(yt.remaining),
    limit_exceeded: yt.exceeded,
    sales_without_purchase_price: yt.unknownCost,
    sales: yt.sales.map((s) => ({ name: s.name, qty: s.qty, price_eur: s.priceEur, fees_eur: s.feesEur, sold: s.soldAt.slice(0, 10), bought: s.boughtAt, channel: s.channel })),
    already_tax_free_items: items.filter((c) => taxFreeFrom(boughtAt(c)) <= today()).length,
    becoming_tax_free_soon: soon,
  };
}

// ---------- actions (confirmed by the user) ----------

async function proposeAction(i: Input, toolUseId: string) {
  const action = str(i.action);
  const ok = await requestConfirmation(toolUseId);
  if (!ok) return { status: 'declined', note: 'Der Nutzer hat abgelehnt. Nicht erneut vorschlagen, außer er fragt.' };
  const id = str(i.card_id);
  const card = id ? await findCard(id) : null;
  if (action !== 'remember' && !card) throw new Error('card_id fehlt');
  const c = card?.summary;
  switch (action) {
    case 'watch_add': {
      const list = readWatchlist();
      if (!list.some((w) => w.id === c!.id)) {
        const item: WatchItem = { id: c!.id, nameJa: c!.nameJa, nameEn: c!.nameEn, setId: c!.setId, number: c!.number, image: c!.image, addedAt: new Date().toISOString() };
        write('ct-watch', [item, ...list]);
      }
      return { status: 'confirmed', done: 'Auf der Watchlist' };
    }
    case 'collection_add': {
      const amount = num(i.cost_amount);
      addCollectionItem({
        cardId: c!.id,
        nameJa: c!.nameJa,
        nameEn: c!.nameEn,
        setId: c!.setId,
        setName: c!.setName,
        number: c!.number,
        rarity: c!.rarity,
        image: card?.s ? null : c!.image,
        photo: card?.s ? c!.image : null,
        kind: card?.s ? 'sealed' : 'card',
        qty: int(i.qty, 1, 999),
        condition: (str(i.condition) as Condition | undefined) ?? 'NM',
        cost: amount ? { amount, currency: str(i.cost_currency) === 'EUR' ? 'EUR' : 'JPY' } : null,
        boughtAt: today(),
      });
      return { status: 'confirmed', done: 'In der Sammlung' };
    }
    case 'sale_record': {
      const price = num(i.price_eur);
      if (price == null) throw new Error('price_eur fehlt');
      let left = int(i.qty, 1, 999);
      const { data } = await market();
      const cur = readList<CollectionItem>('ct-collection');
      // Oldest copies first (they are the most likely to be tax-free).
      const mine = cur.filter((x) => x.cardId === c!.id).sort((a, b) => boughtAt(a).localeCompare(boughtAt(b)));
      let next = cur;
      const fees = num(i.fees_eur) ?? 0;
      const totalQty = left;
      for (const x of mine) {
        if (!left) break;
        const take = Math.min(left, x.qty);
        left -= take;
        const costEach = x.cost ? (x.cost.currency === 'EUR' ? x.cost.amount : x.cost.amount * data.fx.jpyToEur) : null;
        addSale({ cardId: c!.id, name: c!.nameEn ?? c!.nameJa, setId: c!.setId, qty: take, priceEur: price, feesEur: (fees * take) / totalQty, channel: str(i.channel) ?? 'unbekannt', soldAt: new Date().toISOString(), boughtAt: boughtAt(x), costEur: costEach });
        next = take === x.qty ? next.filter((y) => y.uid !== x.uid) : next.map((y) => (y.uid === x.uid ? { ...y, qty: y.qty - take } : y));
      }
      if (left) addSale({ cardId: c!.id, name: c!.nameEn ?? c!.nameJa, setId: c!.setId, qty: left, priceEur: price, feesEur: (fees * left) / totalQty, channel: str(i.channel) ?? 'unbekannt', soldAt: new Date().toISOString(), boughtAt: null, costEur: null });
      write('ct-collection', next);
      const yt = yearTax(readSales());
      return { status: 'confirmed', done: 'Verkauf eingetragen', not_in_collection: left || undefined, tax_year: { taxable_gains_eur: r2(yt.taxableGain), remaining_eur: r2(yt.remaining) } };
    }
    case 'alert_add': {
      const a = { belowEur: num(i.below_eur) ?? null, aboveEur: num(i.above_eur) ?? null, crBuyAboveJpy: num(i.cr_buy_above_jpy) ?? null };
      if (a.belowEur == null && a.aboveEur == null && a.crBuyAboveJpy == null) throw new Error('Kein Schwellenwert angegeben');
      addAlert({ cardId: c!.id, name: c!.nameEn ?? c!.nameJa, ...a });
      return { status: 'confirmed', done: 'Alarm angelegt – wird geprüft, solange die App offen ist und beim Öffnen' };
    }
    case 'remember': {
      // Exactly the text the user saw on the confirmation card.
      const fact = str(i.fact);
      if (!fact) throw new Error('fact fehlt');
      addMemory(fact);
      return { status: 'confirmed', done: 'Gemerkt' };
    }
  }
  throw new Error(`Unbekannte Aktion: ${action}`);
}

// ---------- dispatch ----------

export async function runTool(name: string, input: Input, toolUseId: string): Promise<string> {
  const out = await (async (): Promise<unknown> => {
    switch (name as AgentToolName) {
      case 'search_cards':
        return searchCards(input);
      case 'card_details':
        return cardDetails(input);
      case 'compute_margin':
        return computeMarginTool(input);
      case 'market_overview':
        return marketOverview(input);
      case 'find_opportunities':
        return findOpportunities(input);
      case 'portfolio':
        return portfolioTool(input);
      case 'sell_options':
        return sellOptions(input);
      case 'tax_overview':
        return taxOverview(input);
      case 'show_cards':
        return { shown: Array.isArray(input.ids) ? input.ids.length : 0 };
      case 'open_tool':
        return { shown: 'Button angezeigt – der Nutzer kann ihn antippen.' };
      case 'propose_action':
        return proposeAction(input, toolUseId);
    }
    throw new Error(`Unbekanntes Werkzeug: ${name}`);
  })();
  const json = JSON.stringify(out);
  // Keep every result well inside what the server accepts.
  return json.length > 70_000 ? JSON.stringify({ truncated: true, part: json.slice(0, 69_000) }) : json;
}

