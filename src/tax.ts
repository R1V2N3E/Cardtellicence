// Private sales in Germany (§ 23 EStG, private Veräußerungsgeschäfte): a gain is tax-free when
// the item was held for more than one year. Gains from sales within a year are taxed only when
// their total in a calendar year reaches the exemption limit (Freigrenze, 1,000 € from 2024) —
// then all of it is taxable. Hints, not tax advice.
import { readList, useStored, write, type CollectionItem } from './state';

export const FREIGRENZE_EUR = 1000;
const DAY = 86400_000;

export interface SaleRecord {
  id: string;
  cardId: string;
  name: string;
  setId: string;
  qty: number;
  priceEur: number; // per copy
  feesEur: number; // fees + shipping for the whole sale
  channel: string;
  soldAt: string; // ISO date
  boughtAt: string | null;
  costEur: number | null; // per copy, null = unknown
}

export const readSales = () => readList<SaleRecord>('ct-sales');
export const useSales = () => useStored<SaleRecord[]>('ct-sales', readSales);
export const addSale = (s: Omit<SaleRecord, 'id'>) => write('ct-sales', [{ ...s, id: crypto.randomUUID() }, ...readSales()]);
export const removeSale = (id: string) => write('ct-sales', readSales().filter((s) => s.id !== id));

/** When an item was bought: the purchase date if entered, else when it was added. */
export const boughtAt = (i: Pick<CollectionItem, 'addedAt' | 'boughtAt'>) => i.boughtAt ?? i.addedAt.slice(0, 10);

/** First day a sale is tax-free: one year and a day after the purchase. */
export function taxFreeFrom(bought: string): string {
  const d = new Date(bought.slice(0, 10) + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return new Date(d.getTime() + DAY).toISOString().slice(0, 10);
}

export const isTaxFree = (bought: string | null, soldAt: string) => !!bought && soldAt.slice(0, 10) >= taxFreeFrom(bought);

export const saleGain = (s: SaleRecord) => (s.costEur == null ? null : s.qty * (s.priceEur - s.costEur) - s.feesEur);

export interface YearTax {
  year: number;
  taxableGain: number; // net of losses, from sales within the holding period
  taxFreeGain: number;
  unknownCost: number; // sales without a purchase price (gain unknown)
  remaining: number; // until the exemption limit is reached
  exceeded: boolean;
  sales: SaleRecord[];
}

export function yearTax(sales: SaleRecord[], year = new Date().getFullYear()): YearTax {
  const inYear = sales.filter((s) => s.soldAt.startsWith(String(year)));
  let taxableGain = 0;
  let taxFreeGain = 0;
  let unknownCost = 0;
  for (const s of inYear) {
    const g = saleGain(s);
    if (g == null) unknownCost++;
    else if (isTaxFree(s.boughtAt, s.soldAt)) taxFreeGain += g;
    else taxableGain += g;
  }
  return {
    year,
    taxableGain,
    taxFreeGain,
    unknownCost,
    remaining: Math.max(0, FREIGRENZE_EUR - taxableGain),
    exceeded: taxableGain >= FREIGRENZE_EUR,
    sales: inYear,
  };
}

export const daysUntil = (date: string) => Math.ceil((Date.parse(date + 'T00:00:00Z') - Date.now()) / DAY);
