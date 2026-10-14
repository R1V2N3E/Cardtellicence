import { mapLimit } from './http.js';
import { englishName, findDexIds } from './pokedex.js';
import { getRawCard, getSet, listSets, searchCards, toSummary } from './tcgdex.js';
import type { CardSummary } from './types.js';

const JAPANESE = /[぀-ヿ一-龯]/;
// "SV2a 201", "sv2a-201", "M2 110/080"
const SET_NUMBER = /^([a-z]{1,4}\d{0,2}[a-z]?)[\s-]+(\d{1,3})(?:\/\d+)?$/i;
const SET_ONLY = /^([a-z]{1,4}\d{1,2}[a-z]?)$/i;
// "116/80", "116/080", "116 / 80"
const NUMBER_TOTAL = /^(\d{1,3})\s*\/\s*(\d{1,3})$/;
// "116" — searched in the modern (Scarlet & Violet and Mega) sets
const NUMBER_ONLY = /^#?(\d{1,3})$/;
const MODERN_SET = /^(SV|M)\d/;

/** Fetch card <n> from each set, trying the zero-padded and plain local ids. */
export async function cardsByNumber(setIds: string[], n: string): Promise<CardSummary[]> {
  const found = await mapLimit(setIds, 8, async (setId) => {
    for (const localId of [n.padStart(3, '0'), String(Number(n))]) {
      const raw = await getRawCard(`${setId}-${localId}`).catch(() => null);
      if (raw) return toSummary(raw);
    }
    return null;
  });
  return found.filter((c): c is CardSummary => c !== null).reverse(); // newest sets first
}

type Brief = { id: string; localId: string; name: string; image?: string };

function briefToSummary(b: Brief, nameEn: string | null, setName = ''): CardSummary {
  const setId = b.id.slice(0, b.id.length - b.localId.length - 1);
  return { id: b.id, setId, setName, localId: b.localId, number: b.localId, nameJa: b.name, nameEn, rarity: null, image: b.image ?? null };
}

/** Case-insensitive match of a user-typed set code to a TCGdex set id ("sv2a" -> "SV2a"). */
export async function resolveSetId(code: string): Promise<string | null> {
  const sets = await listSets();
  return sets.find((s) => s.id.toLowerCase() === code.toLowerCase())?.id ?? null;
}

export async function search(qRaw: string): Promise<CardSummary[]> {
  const q = qRaw.trim();
  if (!q) return [];

  const sn = q.match(SET_NUMBER);
  if (sn) {
    const setId = await resolveSetId(sn[1]);
    if (setId) {
      for (const localId of [sn[2].padStart(3, '0'), String(Number(sn[2]))]) {
        const raw = await getRawCard(`${setId}-${localId}`).catch(() => null);
        if (raw) return [toSummary(raw)];
      }
    }
  }

  const nt = q.match(NUMBER_TOTAL);
  if (nt) {
    const total = Number(nt[2]);
    const sets = (await listSets()).filter((s) => s.cardCount.official === total).map((s) => s.id);
    return cardsByNumber(sets, nt[1]);
  }

  const no = q.match(NUMBER_ONLY);
  if (no) {
    const n = Number(no[1]);
    const sets = (await listSets()).filter((s) => MODERN_SET.test(s.id) && s.cardCount.total >= n).map((s) => s.id);
    return cardsByNumber(sets, no[1]);
  }

  if (SET_ONLY.test(q)) {
    const setId = await resolveSetId(q);
    if (setId) {
      const set = await getSet(setId);
      return set.cards.map((c) => briefToSummary(c, englishName(c.name, []), set.name)).reverse();
    }
  }

  if (JAPANESE.test(q)) {
    const list = await searchCards({ name: q }, 80);
    return list.map((b) => briefToSummary(b, englishName(b.name, [])));
  }

  const dexIds = findDexIds(q);
  if (!dexIds.length) return [];
  const lists = await mapLimit(dexIds.slice(0, 4), 4, (d) => searchCards({ dexId: `eq:${d}` }, 120));
  const seen = new Set<string>();
  const out: CardSummary[] = [];
  lists.forEach((list, i) => {
    for (const b of list) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(briefToSummary(b, englishName(b.name, [dexIds[i]])));
    }
  });
  return out;
}
