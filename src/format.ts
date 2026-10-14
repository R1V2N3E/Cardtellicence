const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const jpy = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmtEur = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '–' : Math.abs(v) >= 100 ? eur0.format(v) : eur2.format(v);
export const fmtJpy = (v: number | null | undefined) => (v == null ? '–' : jpy.format(v));
export const fmtUsd = (v: number | null | undefined) => (v == null ? '–' : usd.format(v));
export const fmtPct = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);
export const fmtSigned = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${fmtEur(v)}`);

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });

/** TCGdex image URLs need a quality suffix. */
export const cardImg = (base: string | null | undefined, q: 'low' | 'high' = 'low') => (base ? `${base}/${q}.webp` : null);

/** Yuyu-tei thumbnail derived from its product URL (…/card/sv02a/10507). */
export function yuyuteiImg(url: string | null | undefined): string | null {
  const m = url?.match(/card\/([a-z0-9]+)\/(\d+)/);
  return m ? `https://card.yuyu-tei.jp/poc/200_280/${m[1]}/${m[2]}.jpg` : null;
}

export const marginClass = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'pos' : 'neg');
