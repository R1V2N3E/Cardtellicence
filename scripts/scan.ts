// Daily opportunity scanner (run by .github/workflows/scan.yml, or `npm run scan`).
//
// For every configured Japanese set it joins:
//   - Cardmarket price guide for the Japanese printing (via TCGdex), EUR
//   - Yuyu-tei shop price + stock, JPY
// then enriches the best candidates with the SNKRDUNK lowest ask, and writes
//   public/data/opportunities.json   (what the Deals screen shows)
//   public/data/history/<set>.json   (daily price snapshots for the charts)
//
// Env: SCAN_SETS="SV2a,SV8a" to limit sets, SCAN_ALL=1 to include non-secret-rare cards.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getFx } from '../lib/fx.js';
import { mapLimit } from '../lib/http.js';
import { findSnkrdunk } from '../lib/snkrdunk.js';
import { sealedForSet } from '../lib/sealed.js';
import type { SealedItem } from '../lib/types.js';
import { cardmarketFor } from '../lib/prices.js';
import { getRawCard, getSet, listSets, toSummary } from '../lib/tcgdex.js';
import type { HistoryFile, Opportunity, OpportunityFile } from '../lib/types.js';
import { getYuyuteiSet } from '../lib/yuyutei.js';

const DEFAULT_SETS = [
  // Mega era
  'M1L', 'M1S', 'M2', 'M2a', 'M3', 'M4', 'M5', 'M6',
  // Scarlet & Violet
  'SV1S', 'SV1V', 'SV1a', 'SV2P', 'SV2D', 'SV2a', 'SV3', 'SV3a', 'SV4K', 'SV4M', 'SV4a', 'SV5K', 'SV5M', 'SV5a',
  'SV6', 'SV6a', 'SV7', 'SV7a', 'SV8', 'SV8a', 'SV9', 'SV9a', 'SV10', 'SV11B', 'SV11W',
  // Sword & Shield / Sun & Moon chase sets
  // (S6a Eevee Heroes, S4a Shiny Star V, S10b have no card list in TCGdex yet.)
  'S12a', 'S11a', 'S8b', 'SM12a', 'SM11b', 'SM8b',
];
const MIN_TREND_EUR = 3;
const SNK_MIN_EUR = 5;
const SNK_MAX = 900;
const YYT_CARRY_DAYS = 14;
const HISTORY_DAYS = 400;

const OUT_DIR = new URL('../public/data/', import.meta.url);
const today = new Date().toISOString().slice(0, 10);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function scanSet(setId: string, all: boolean): Promise<Opportunity[]> {
  const set = await getSet(setId);
  const official = set.cardCount.official;
  // Secret rares (numbered above the official count) carry nearly all the value. Sets
  // without secret numbering (e.g. SV11B) are scanned in full.
  const secret = set.cards.filter((c) => !/^\d+$/.test(c.localId) || Number(c.localId) > official);
  const candidates = all || !secret.length ? set.cards : secret;
  const [yyt, raws] = await Promise.all([
    getYuyuteiSet(setId).catch((e) => {
      log(`  yuyu-tei ${setId}: ${e.message}`);
      return [];
    }),
    mapLimit(candidates, 6, (c) => getRawCard(c.id).catch(() => null)),
  ]);

  const rows: Opportunity[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    const cm = await cardmarketFor(raw).catch(() => null);
    if (!cm?.trend || cm.trend < MIN_TREND_EUR) continue;
    const s = toSummary(raw);
    const exact = yyt.filter((r) => r.number === s.number);
    const shop = (exact.length ? exact : yyt.filter((r) => r.number.split('/')[0] === s.number.split('/')[0]))
      .sort((a, b) => (a.stock === 0 ? 1 : 0) - (b.stock === 0 ? 1 : 0) || a.priceJpy - b.priceJpy)[0];
    rows.push({
      id: s.id,
      setId: s.setId,
      setName: set.name,
      number: s.number,
      nameJa: s.nameJa,
      nameEn: s.nameEn,
      rarity: s.rarity,
      image: s.image,
      cmTrend: cm.trend,
      cmAvg30: cm.avg30,
      cmLow: cm.low,
      yytJpy: shop?.priceJpy ?? null,
      yytStock: shop?.stock ?? null,
      yytUrl: shop?.url ?? null,
      snkAskJpy: null,
    });
  }
  log(`  ${setId} ${set.name}: ${candidates.length} cards checked, ${rows.length} priced, ${yyt.length} yuyu-tei rows`);
  return rows;
}

function writeHistory(items: Opportunity[]) {
  const dir = new URL('history/', OUT_DIR);
  mkdirSync(dir, { recursive: true });
  const bySet = new Map<string, Opportunity[]>();
  for (const i of items) bySet.set(i.setId, [...(bySet.get(i.setId) ?? []), i]);
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400_000).toISOString().slice(0, 10);
  for (const [setId, rows] of bySet) {
    const file = new URL(`${setId}.json`, dir);
    const hist: HistoryFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    for (const r of rows) {
      const series = (hist[r.id] ?? []).filter(([d]) => d !== today && d >= cutoff);
      series.push([today, r.cmTrend, r.cmAvg30, r.yytJpy]);
      hist[r.id] = series;
    }
    writeFileSync(file, JSON.stringify(hist));
  }
}

async function main() {
  const all = process.env.SCAN_ALL === '1';
  const known = new Set((await listSets()).map((s) => s.id));
  const wanted = (process.env.SCAN_SETS ? process.env.SCAN_SETS.split(',') : DEFAULT_SETS).map((s) => s.trim()).filter(Boolean);
  const sets = wanted.filter((s) => known.has(s));
  const fx = await getFx();
  log(`scanning ${sets.length} sets, 1 JPY = ${fx.jpyToEur.toFixed(5)} EUR (${fx.date})`);

  const items: Opportunity[] = [];
  const setMeta: OpportunityFile['sets'] = [];
  for (const setId of sets) {
    try {
      const rows = await scanSet(setId, all);
      items.push(...rows);
      if (rows.length) setMeta.push({ id: setId, name: rows[0].setName });
    } catch (e) {
      log(`  ${setId} failed: ${(e as Error).message}`);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = new URL('opportunities.json', OUT_DIR);
  const prev: OpportunityFile | null = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null;
  const prevById = new Map(prev?.items.map((o) => [o.id, o]) ?? []);

  // Yuyu-tei blocks most cloud networks. When a set couldn't be read, keep the last known
  // shop price (up to YYT_CARRY_DAYS old) and record its date so the app can show it.
  const today = new Date().toISOString().slice(0, 10);
  const carryCutoff = new Date(Date.now() - YYT_CARRY_DAYS * 86400_000).toISOString().slice(0, 10);
  let carried = 0;
  for (const o of items) {
    if (o.yytJpy) continue;
    const p = prevById.get(o.id);
    const asOf = p?.yytAsOf ?? prev?.generatedAt.slice(0, 10);
    if (p?.yytJpy && asOf && asOf >= carryCutoff) {
      Object.assign(o, { yytJpy: p.yytJpy, yytStock: p.yytStock, yytUrl: p.yytUrl, yytAsOf: asOf });
      carried++;
    }
  }
  for (const o of items) if (o.yytJpy && !o.yytAsOf) o.yytAsOf = today;
  if (carried) log(`carried over ${carried} Yuyu-tei prices from earlier scans`);

  // SNKRDUNK lowest ask for every card worth at least SNK_MIN_EUR, most valuable first.
  // One search request per card, sequential and slow to stay under its rate limit.
  const queue = items.filter((o) => (o.cmTrend ?? 0) >= SNK_MIN_EUR).sort((a, b) => b.cmTrend! - a.cmTrend!).slice(0, SNK_MAX);
  let failures = 0;
  let found = 0;
  for (const o of queue) {
    if (failures >= 5) {
      log('  snkrdunk: stopping after repeated errors');
      break;
    }
    try {
      const hit = await findSnkrdunk(o.setId, o.number);
      failures = 0;
      if (hit?.priceJpy) {
        o.snkAskJpy = hit.priceJpy;
        o.snkId = hit.id;
        if (!o.image && !o.yytUrl) o.snkImg = hit.image;
        found++;
      }
    } catch (e) {
      failures++;
      log(`  snkrdunk ${o.id}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 450));
  }
  log(`snkrdunk asks for ${found}/${queue.length}`);

  // Sealed: booster box + pack per scanned set (Cardmarket price guide vs. SNKRDUNK).
  const sealed: SealedItem[] = [];
  for (const setId of sets) {
    try {
      sealed.push(...(await sealedForSet(setId)));
    } catch (e) {
      log(`  sealed ${setId}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  log(`sealed products: ${sealed.length} (${sealed.filter((x) => x.snkAskJpy).length} with SNKRDUNK price)`);

  // A partial scan (SCAN_SETS) refreshes only its sets and keeps the rest of the last scan.
  if (process.env.SCAN_SETS && prev) {
    const scanned = new Set(sets);
    items.unshift(...prev.items.filter((o) => !scanned.has(o.setId)));
    setMeta.unshift(...prev.sets.filter((s) => !scanned.has(s.id)));
    sealed.unshift(...(prev.sealed ?? []).filter((x) => !scanned.has(x.setId)));
  }
  const file: OpportunityFile = { generatedAt: new Date().toISOString(), fx, sets: setMeta, items, sealed };
  writeFileSync(outFile, JSON.stringify(file));
  writeHistory(items.filter((o) => sets.includes(o.setId)));
  log(`wrote ${items.length} cards`);
}

await main();
