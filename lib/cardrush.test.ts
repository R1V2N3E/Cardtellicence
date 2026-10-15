import { describe, expect, it } from 'vitest';
import { packCodes, parsePage } from './cardrush';

const page = (rows: unknown[]) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { buyingPrices: rows, lastPage: 2 } } })}</script></html>`;

describe('card rush', () => {
  it('tries the set code spellings Card Rush uses', () => {
    expect(packCodes('SV2a')).toEqual(['SV2a', 'sv2a']);
    expect(packCodes('SM12a')).toEqual(['SM12a', 'sm12a']);
  });

  it('reads the price list from the page data', () => {
    const p = parsePage(page([{ name: 'リザードンex', model_number: '201/165', extra_difference: '', amount: 35000, ocha_product: { id: 43860, price: 62800, stock_count: 62 } }]));
    expect(p.lastPage).toBe(2);
    expect(p.buyingPrices[0].ocha_product?.price).toBe(62800);
  });

  it('fails loudly when the page format changes', () => {
    expect(() => parsePage('<html></html>')).toThrow();
  });
});
