// Market analysis over every tracked card of the daily scan: value per set and generation,
// how it moves, and which cards lag behind a rising set or trade cheaper in Europe than in Japan.
//
// The numbers, so they can always be explained:
//   Set value     = sum of the Cardmarket trend prices of all tracked cards of the set
//   Card momentum = 7-day average / 30-day average − 1 (both from real sales). Not "trend vs.
//                   average": the trend is a near-mint price while the averages include played
//                   copies, so on older sets that would measure the condition mix, not a move.
//                   Only counted while both averages stay within 0.6–1.6× the trend: outside
//                   that band the few sales are a mix of conditions, not a price move.
//   Set momentum  = value-weighted median of its cards' momentum, so one thinly traded card
//                   can't move a whole set
//   JP premium    = Card Rush price (in €) / Cardmarket trend
import type { MarketFile, Opportunity } from '../lib/types';

export type Era = 'mega' | 'sv' | 'swsh' | 'sm';
export const ERAS: { key: Era; label: string; short: string }[] = [
  { key: 'mega', label: 'Mega (MEGA)', short: 'MEGA' },
  { key: 'sv', label: 'Karmesin & Purpur', short: 'KP' },
  { key: 'swsh', label: 'Schwert & Schild', short: 'SWSH' },
  { key: 'sm', label: 'Sonne & Mond', short: 'SM' },
];

export function eraOf(setId: string): Era {
  if (/^sm/i.test(setId)) return 'sm';
  if (/^sv/i.test(setId)) return 'sv';
  if (/^s\d/i.test(setId)) return 'swsh';
  return 'mega';
}

export interface CardStat {
  o: Opportunity;
  value: number; // Cardmarket trend, €
  mom30: number | null; // momentum: 7-day vs 30-day average
  jpEur: number | null; // Card Rush sell price in €
  jpPremium: number | null;
}

export interface GroupStat {
  key: string;
  name: string;
  era: Era;
  value: number;
  change30: number | null; // momentum: 7-day vs 30-day average (see top)
  jpValue: number; // Σ Card Rush prices (€) of the cards Card Rush lists
  cards: number;
  momCards: number; // cards whose momentum counts (see top); few → thin data
  top: CardStat | null;
}

const plausible = (avg: number, trend: number) => trend > 0 && avg / trend >= 0.6 && avg / trend <= 1.6;
const ratio = (a: number, b: number) => (b > 0 && a > 0 ? a / b - 1 : null);

export function cardStat(o: Opportunity, jpyToEur: number): CardStat {
  const value = o.cmTrend ?? 0;
  const jpEur = o.crJpy ? o.crJpy * jpyToEur : null;
  return {
    o,
    value,
    mom30: o.cmAvg30 && o.cmAvg7 && plausible(o.cmAvg30, value) && plausible(o.cmAvg7, value) ? ratio(o.cmAvg7, o.cmAvg30) : null,
    jpEur,
    jpPremium: jpEur && value > 0 ? jpEur / value : null,
  };
}

/** Median of values weighted by w: the change of "the typical euro" in the group. */
export function weightedMedian(pairs: [number, number][]): number | null {
  const xs = pairs.filter(([v, w]) => Number.isFinite(v) && w > 0).sort((a, b) => a[0] - b[0]);
  const total = xs.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let acc = 0;
  for (const [v, w] of xs) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return xs[xs.length - 1][0];
}

function aggregate(key: string, name: string, era: Era, cards: CardStat[]): GroupStat {
  let value = 0;
  let jpValue = 0;
  let top: CardStat | null = null;
  const m30: [number, number][] = [];
  for (const c of cards) {
    value += c.value;
    if (c.mom30 != null) m30.push([c.mom30, c.value]);
    if (c.jpEur) jpValue += c.jpEur;
    if (!top || c.value > top.value) top = c;
  }
  return { key, name, era, value, change30: m30.length >= 5 ? weightedMedian(m30) : null, jpValue, cards: cards.length, momCards: m30.length, top };
}

export interface MarketView {
  cards: CardStat[];
  sets: GroupStat[];
  eras: GroupStat[];
  total: GroupStat;
  bySet: Map<string, CardStat[]>;
}

export function buildMarket(items: Opportunity[], setNames: { id: string; name: string }[], jpyToEur: number): MarketView {
  const cards = items.filter((o) => (o.cmTrend ?? 0) > 0).map((o) => cardStat(o, jpyToEur));
  const bySet = new Map<string, CardStat[]>();
  for (const c of cards) bySet.set(c.o.setId, [...(bySet.get(c.o.setId) ?? []), c]);
  const names = new Map(setNames.map((s) => [s.id, s.name]));
  const sets = [...bySet.entries()].map(([id, cs]) => aggregate(id, names.get(id) ?? cs[0].o.setName, eraOf(id), cs));
  const eras = ERAS.map((e) => aggregate(e.key, e.label, e.key, cards.filter((c) => eraOf(c.o.setId) === e.key))).filter((e) => e.cards);
  return { cards, sets, eras, total: aggregate('all', 'Gesamtmarkt', 'mega', cards), bySet };
}

/**
 * Cards that lag behind their rising set: the set went up at least 5 %, the card stayed roughly
 * flat (between −15 % and 10 points below the set). Cards that crashed are not "lagging" — they
 * are falling, and listed under losers instead.
 */
export function laggards(view: MarketView, minValue = 5) {
  const rising = new Map(view.sets.filter((s) => (s.change30 ?? 0) >= 0.05).map((s) => [s.key, s]));
  return view.cards
    .filter((c) => c.value >= minValue && c.mom30 != null && rising.has(c.o.setId))
    .map((c) => ({ c, set: rising.get(c.o.setId)!, lag: rising.get(c.o.setId)!.change30! - c.mom30! }))
    .filter((x) => x.lag >= 0.1 && x.c.mom30! >= -0.15)
    .sort((a, b) => b.lag - a.lag);
}

export const movers = (view: MarketView, dir: 1 | -1, minValue = 5) =>
  view.cards.filter((c) => c.value >= minValue && c.mom30 != null && c.mom30 * dir > 0).sort((a, b) => (b.mom30! - a.mom30!) * dir);

/** Japan values the card much higher than Europe: Cardmarket may be catching up. */
export const jpPremium = (view: MarketView, minValue = 5, minPremium = 1.4) =>
  view.cards.filter((c) => c.value >= minValue && (c.jpPremium ?? 0) >= minPremium).sort((a, b) => b.jpPremium! - a.jpPremium!);

/**
 * Daily value of a set (or of several / all sets) from market.json: [t, €]. The scan grew over
 * time (more sets, more cards per set), so the days are chained: each step uses only the sets
 * tracked with the same number of cards on both days, and the line ends at today's real value.
 * New coverage therefore never shows up as a fake jump.
 */
export function indexSeries(market: MarketFile | null, setIds: string[] | null): { t: number; v: number }[] {
  if (!market) return [];
  const wanted = setIds && new Set(setIds);
  const days = Object.keys(market.days).sort();
  const pick = (d: string) => Object.entries(market.days[d]).filter(([id]) => !wanted || wanted.has(id));
  const out: { t: number; v: number }[] = [];
  let level = 1;
  for (let i = 0; i < days.length; i++) {
    const today = pick(days[i]);
    if (!today.length) continue;
    if (out.length) {
      const prev = new Map(pick(days[i - 1]));
      let a = 0;
      let b = 0;
      for (const [id, e] of today) {
        const p = prev.get(id);
        if (p && p[2] === e[2] && p[0] > 0) (a += e[0]), (b += p[0]);
      }
      if (b > 0) level *= a / b;
    }
    out.push({ t: Date.parse(days[i]), v: level });
  }
  const now = pick(days[days.length - 1] ?? '').reduce((s, [, e]) => s + e[0], 0);
  const last = out[out.length - 1]?.v ?? 1;
  return out.map((p) => ({ t: p.t, v: (p.v / last) * now }));
}

export const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(digits).replace('.', ',')} %`;

/** Change of a daily index over its whole span (null until there are two days). */
export function seriesChange(points: { t: number; v: number }[]): number | null {
  return points.length >= 2 && points[0].v > 0 ? points[points.length - 1].v / points[0].v - 1 : null;
}

export const MOM_LABEL = '7T/30T';

/** Adds the current live value as the newest point of a daily series. */
export const withNow = (points: { t: number; v: number }[], value: number, at: string | null) =>
  at && points.length && value > 0 && Date.parse(at) > points[points.length - 1].t ? [...points, { t: Date.parse(at), v: value }] : points;
