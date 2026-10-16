import { describe, expect, it } from 'vitest';
import { isTaxFree, taxFreeFrom, yearTax, type SaleRecord } from '../src/tax';

const sale = (p: Partial<SaleRecord>): SaleRecord => ({
  id: Math.random().toString(),
  cardId: 'x',
  name: 'x',
  setId: 'S',
  qty: 1,
  priceEur: 100,
  feesEur: 0,
  channel: 'Cardmarket',
  soldAt: '2026-06-01T10:00:00Z',
  boughtAt: '2026-01-01',
  costEur: 50,
  ...p,
});

describe('private sales tax (§ 23 EStG)', () => {
  it('is tax-free only after more than one year', () => {
    expect(taxFreeFrom('2025-03-10')).toBe('2026-03-11');
    expect(isTaxFree('2025-03-10', '2026-03-10T12:00:00Z')).toBe(false);
    expect(isTaxFree('2025-03-10', '2026-03-11T08:00:00Z')).toBe(true);
    expect(isTaxFree(null, '2030-01-01')).toBe(false);
  });

  it('sums taxable gains per year, nets losses and applies the 1,000 € Freigrenze', () => {
    const sales = [
      sale({ priceEur: 700, costEur: 100, feesEur: 20 }), // +580 taxable
      sale({ priceEur: 500, costEur: 50 }), // +450 taxable
      sale({ priceEur: 40, costEur: 100 }), // −60 taxable (loss offsets)
      sale({ priceEur: 900, costEur: 100, boughtAt: '2024-01-01' }), // tax-free
      sale({ costEur: null }), // unknown
      sale({ soldAt: '2025-12-31T00:00:00Z', priceEur: 5000 }), // other year
    ];
    const y = yearTax(sales, 2026);
    expect(y.taxableGain).toBe(970);
    expect(y.taxFreeGain).toBe(800);
    expect(y.unknownCost).toBe(1);
    expect(y.exceeded).toBe(false);
    expect(y.remaining).toBe(30);
    expect(yearTax([...sales, sale({ priceEur: 80, costEur: 50 })], 2026).exceeded).toBe(true);
  });
});
