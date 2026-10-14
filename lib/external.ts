// Cards from Japanese products that TCGdex doesn't list (starter decks, build sets, some promos)
// are identified through SNKRDUNK instead. Their ids look like "snk-704401".
import { cached, decodeHtml, getJson } from './http.js';
import type { SnkrdunkHit } from './snkrdunk.js';
import type { CardSummary } from './types.js';

export const isExternalId = (id: string) => /^snk-\d+$/.test(id);
export const externalSnkId = (id: string) => Number(id.slice(4));

/** Parse "ミライドンex SAR [SVHM 011/053](スターターデッキ&ビルドセット「未来のミライドンex」) - ¥1,200". */
export function parseSnkLabel(label: string) {
  const m = decodeHtml(label).match(/^(.*?)\s*\[([A-Za-z0-9-]+)\s+([^\]]+)\]\s*(?:\((.*)\))?/);
  if (!m) return null;
  const [, head, setId, number, product = ''] = m;
  const parts = head.trim().split(/\s+/);
  const rarity = parts.length > 1 && /^[A-Z]{1,4}$/.test(parts[parts.length - 1]) ? parts.pop()! : null;
  const setName = product.match(/「(.+?)」/)?.[1] ?? product;
  return { nameJa: parts.join(' '), rarity, setId, number: number.trim(), setName };
}

export function externalSummary(hit: Pick<SnkrdunkHit, 'id' | 'label' | 'image'>, nameEn: string | null = null): CardSummary | null {
  const p = parseSnkLabel(hit.label.replace(/\s*-\s*¥[\d,]*\s*$/, ''));
  if (!p) return null;
  return {
    id: `snk-${hit.id}`,
    setId: p.setId,
    setName: p.setName,
    localId: p.number.split('/')[0],
    number: p.number,
    nameJa: p.nameJa,
    nameEn,
    rarity: p.rarity,
    image: null,
    externalImage: hit.image,
  };
}

interface RawApparel {
  id: number;
  localizedName?: string;
  primaryMedia?: { imageUrl?: string };
}

/** Card summary for an external id, from SNKRDUNK's product record. */
export function getExternalCard(id: string): Promise<CardSummary> {
  return cached(`ext:${id}`, 24 * 3600_000, async () => {
    const a = await getJson<RawApparel>(`https://snkrdunk.com/v1/apparels/${externalSnkId(id)}`);
    const s = externalSummary({ id: a.id, label: a.localizedName ?? '', image: a.primaryMedia?.imageUrl ?? null });
    if (!s) throw new Error('Unbekannte Karte');
    return s;
  });
}
