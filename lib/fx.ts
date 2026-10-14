import { cached, getText } from './http.js';
import type { FxRates } from './types.js';

// Official euro foreign exchange reference rates published daily by the European Central Bank.
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export function getFx(): Promise<FxRates> {
  return cached('fx', 3 * 3600_000, async () => {
    const xml = await getText(ECB_URL);
    const date = xml.match(/time=['"]([\d-]+)['"]/)?.[1] ?? new Date().toISOString().slice(0, 10);
    const rate = (cur: string) => Number(xml.match(new RegExp(`currency=['"]${cur}['"]\\s+rate=['"]([\\d.]+)`))?.[1]);
    const jpy = rate('JPY');
    const usd = rate('USD');
    if (!jpy || !usd) throw new Error('ECB rates missing');
    return { date, jpyToEur: 1 / jpy, usdToEur: 1 / usd, source: 'ECB reference rate' };
  });
}
