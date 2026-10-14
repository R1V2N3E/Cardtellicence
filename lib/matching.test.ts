import { describe, expect, it } from 'vitest';
import { computeMargin, pickBuy, type BuyOption } from '../src/margin';
import { englishName, findDexIds } from './pokedex';
import { formatNumber } from './tcgdex';
import { parseYuyuteiList, yuyuteiCode } from './yuyutei';

describe('set and number mapping', () => {
  it('maps TCGdex set ids to Yuyu-tei codes', () => {
    expect(yuyuteiCode('SV2a')).toBe('sv02a');
    expect(yuyuteiCode('M2')).toBe('m02');
    expect(yuyuteiCode('M2a')).toBe('m02a');
    expect(yuyuteiCode('SV11B')).toBe('sv11b');
    expect(yuyuteiCode('S12a')).toBe('s12a');
    expect(yuyuteiCode('SM12a')).toBe('sm12a');
  });

  it('formats card numbers like Japanese shops print them', () => {
    expect(formatNumber('201', 165)).toBe('201/165');
    expect(formatNumber('110', 80)).toBe('110/080');
    expect(formatNumber('6', 165)).toBe('006/165');
    expect(formatNumber('SV-P-001', 0)).toBe('SV-P-001');
  });
});

describe('names', () => {
  it('finds dex numbers from English and German names', () => {
    expect(findDexIds('Charizard')).toEqual([6]);
    expect(findDexIds('Glurak')).toEqual([6]);
    expect(findDexIds('nachtara')).toEqual([197]);
  });

  it('builds English names for Japanese cards', () => {
    expect(englishName('リザードンex', [6])).toBe('Charizard ex');
    expect(englishName('ブラッキーex', [])).toBe('Umbreon ex');
    expect(englishName('メガリザードンXex', [])).toBe('Mega Charizard X ex');
    expect(englishName('ダークライVSTAR', [])).toBe('Darkrai VSTAR');
    expect(englishName('博士の研究', [])).toBeNull();
  });
});

describe('Yuyu-tei parsing', () => {
  const html = `
<a
href="https://yuyu-tei.jp/sell/poc/card/sv02a/10507"><div
class="position-relative product-img">
<img
src="https://card.yuyu-tei.jp/poc/100_140/sv02a/10507.jpg" alt="201/165 SAR リザードンex" class="card img-fluid"/></div>
</a>
<strong
class="d-block text-end ">
59,800 円
</strong><div
class="form-check p-0">
<label
class="form-check-label fw-bold float-start cart_sell_zaiko" for="flexRadioDefault1">
在庫 :
4 点
</label></div>
<a
href="https://yuyu-tei.jp/sell/poc/card/sv02a/10508"><div
class="position-relative product-img">
<img
src="https://card.yuyu-tei.jp/poc/100_140/sv02a/10508.jpg" alt="202/165 SAR ミュウツーex" class="card img-fluid"/></div>
</a>
<strong
class="d-block text-end ">
9,980 円
</strong><div>
<label class="form-check-label fw-bold float-start cart_sell_zaiko">
在庫 :
×
</label>`;

  it('extracts number, rarity, price and stock', () => {
    const rows = parseYuyuteiList(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ver: 'sv02a', number: '201/165', rarity: 'SAR', name: 'リザードンex', priceJpy: 59800, stock: 4 });
    expect(rows[1]).toMatchObject({ number: '202/165', priceJpy: 9980, stock: 0 });
  });
});

describe('margin', () => {
  const opts: BuyOption[] = [
    { source: 'yuyutei', label: 'Yuyu-tei', jpy: 59800 },
    { source: 'snkrdunk', label: 'SNKRDUNK', jpy: 41000 },
  ];
  it('picks the cheapest offer or the requested source', () => {
    expect(pickBuy(opts, 'cheapest')?.source).toBe('snkrdunk');
    expect(pickBuy(opts, 'yuyutei')?.jpy).toBe(59800);
    expect(pickBuy(opts, 'mercari')).toBeNull();
  });
  it('computes margin and ROI in EUR', () => {
    const m = computeMargin(opts[1], 400, 1 / 160);
    expect(m.buyEur).toBeCloseTo(256.25);
    expect(m.marginEur).toBeCloseTo(143.75);
    expect(m.roi).toBeCloseTo(0.561, 2);
  });
});
