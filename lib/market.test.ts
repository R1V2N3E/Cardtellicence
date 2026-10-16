import { describe, expect, it } from 'vitest';
import { buildMarket, indexSeries, laggards } from '../src/market';
import type { MarketFile, Opportunity } from './types';

describe('market index', () => {
  it('chains days so new sets or cards never look like a jump', () => {
    const market: MarketFile = {
      updated: '',
      days: {
        '2026-10-14': { A: [100, 0, 10] },
        // set B starts being tracked, set A rises 10 %
        '2026-10-15': { A: [110, 0, 10], B: [500, 0, 20] },
      },
    };
    const s = indexSeries(market, null);
    expect(s).toHaveLength(2);
    expect(s[1].v).toBeCloseTo(610); // today's real total
    expect(s[0].v).toBeCloseTo(610 / 1.1); // only A's +10 % counts as movement
  });

  it('values sets by the sum of trends, measures momentum as 7-day vs 30-day average and finds laggards', () => {
    const card = (id: string, trend: number, avg30: number, avg7: number): Opportunity =>
      ({ id, setId: 'SV2a', setName: '151', number: id, nameJa: id, nameEn: id, rarity: null, image: null, cmTrend: trend, cmAvg30: avg30, cmAvg7: avg7, cmLow: null, yytJpy: null, yytStock: null, yytUrl: null, snkAskJpy: null }) as Opportunity;
    const cards = [card('a', 130, 100, 120), card('b', 60, 50, 60), card('c', 20, 21, 20), card('d', 3, 3, 3), card('e', 2, 2, 2)];
    // averages far below the trend: a mix of played copies, not a move → no momentum
    cards.push(card('f', 1000, 300, 900));
    const view = buildMarket(cards, [{ id: 'SV2a', name: '151' }], 1 / 160);
    expect(view.sets[0].value).toBe(1215);
    expect(view.cards.find((c) => c.o.id === 'f')!.mom30).toBeNull();
    expect(view.sets[0].change30).toBeCloseTo(0.2); // value-weighted median of +20 %, +20 %, −5 %, 0, 0
    expect(laggards(view).map((x) => x.c.o.id)).toEqual(['c']);
    // fewer than 5 cards with usable momentum → no set momentum
    expect(buildMarket(cards.slice(0, 3), [], 1 / 160).sets[0].change30).toBeNull();
  });
});
