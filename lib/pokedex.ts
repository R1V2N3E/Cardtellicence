import { POKEDEX as rows } from './pokedex-data.js';
const byId = new Map(rows.map((r) => [r[0], r]));

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Dex numbers whose English or German name matches the query (exact first, then prefix). */
export function findDexIds(query: string): number[] {
  const q = norm(query);
  if (q.length < 3) return [];
  const exact = rows.filter((r) => norm(r[1]) === q || norm(r[2]) === q).map((r) => r[0]);
  if (exact.length) return exact;
  return rows
    .filter((r) => norm(r[1]).startsWith(q) || norm(r[2]).startsWith(q))
    .slice(0, 8)
    .map((r) => r[0]);
}

const jaNames = rows.map((r) => [r[3], r[0]] as const).sort((a, b) => b[0].length - a[0].length);

/** Dex ids from a Japanese card name when TCGdex has none, e.g. "ブラッキーex" -> [197]. */
export function dexFromJa(nameJa: string): number[] {
  const base = nameJa.replace(/^(メガ|かがやく|ひかる|ガラル|アローラ|ヒスイ|パルデア|[^\s]+の)/, '');
  const ids: number[] = [];
  for (const part of base.split(/[&＆]/)) {
    const hit = jaNames.find(([ja]) => ja && part.startsWith(ja));
    if (hit) ids.push(hit[1]);
  }
  return ids;
}

const PREFIXES: [string, string][] = [
  ['メガ', 'Mega'], ['かがやく', 'Radiant'], ['ひかる', 'Shining'], ['ガラル', 'Galarian'], ['アローラ', 'Alolan'],
  ['ヒスイ', 'Hisuian'], ['パルデア', 'Paldean'], ['ロケット団の', "Team Rocket's"]
];

const SUFFIXES = ['VMAX', 'VSTAR', 'GX', 'EX', 'ex', 'V', 'BREAK'];

/**
 * English display name for a Japanese card, e.g. "リザードンex" (dex 6) -> "Charizard ex".
 * Returns null for trainers/energy (no dex id).
 */
export function englishName(nameJa: string, dexIds: number[] | undefined): string | null {
  if (!dexIds?.length) dexIds = dexFromJa(nameJa);
  if (!dexIds.length) return null;
  const names = dexIds.map((id) => byId.get(id)?.[1]).filter(Boolean) as string[];
  if (!names.length) return null;
  let base = names.join(' & ');
  const prefix = PREFIXES.find(([ja]) => nameJa.startsWith(ja));
  if (prefix) base = `${prefix[1]} ${base}`;
  const mx = nameJa.match(/メガ.+?([XY])(?:ex|EX)?$/);
  if (mx) base += ` ${mx[1]}`;
  const suffix = SUFFIXES.find((s) => nameJa.endsWith(s));
  return suffix ? `${base} ${suffix}` : base;
}
