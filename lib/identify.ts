// Card recognition from a photo, built so that a wrong card is never presented as certain:
//   1. Claude reads what is printed on the card (set code, number, name, HP, illustrator).
//   2. Candidates are collected from TCGdex (set+number, number/total, name) and, for products
//      TCGdex doesn't list (starter decks etc.), from SNKRDUNK.
//   3. Every candidate is scored against all printed facts; the name must match.
//   4. Claude compares the photo with the best candidates' images and confirms or rejects.
//   5. The result carries a confidence level; the app only preselects on "high".
import Anthropic from '@anthropic-ai/sdk';
import { recordUsage, type AiUsage } from './usage.js';
import { externalSummary } from './external.js';
import { mapLimit, request } from './http.js';
import { cardsByNumber, resolveSetId } from './search.js';
import { findSnkrdunk, searchSnkrdunk } from './snkrdunk.js';
import { formatNumber, getRawCard, listSets, printedTotal, searchCards, toSummary, type RawCard } from './tcgdex.js';
import type { CardSummary } from './types.js';

export interface CardReading {
  is_pokemon_card: boolean;
  language: 'ja' | 'en' | 'other';
  set_code: string | null; // printed bottom-left, e.g. "SV2a", "M2", "svHM"
  number: string | null; // printed collector number, e.g. "201/165"
  name: string | null; // card name as printed (Japanese for Japanese cards)
  rarity: string | null; // printed rarity code, e.g. "SAR"
  hp: number | null;
  illustrator: string | null;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface IdentifyResult {
  reading: CardReading;
  matches: CardSummary[]; // best first; only cards whose name matches the photo
  confidence: Confidence;
  note: string | null; // human-readable explanation when not certain (German, shown in the app)
  checks: { name: boolean; number: boolean; set: boolean; hp: boolean | null; visual: boolean | null } | null;
  // kept for older clients
  matchedBy: 'set+number' | 'number' | 'name' | 'none';
  /** What the recognition cost (filled in by the handler). */
  usage?: AiUsage;
}

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_pokemon_card', 'language', 'set_code', 'number', 'name', 'rarity', 'hp', 'illustrator'],
  properties: {
    is_pokemon_card: { type: 'boolean' },
    language: { type: 'string', enum: ['ja', 'en', 'other'] },
    set_code: { type: ['string', 'null'] },
    number: { type: ['string', 'null'] },
    name: { type: ['string', 'null'] },
    rarity: { type: ['string', 'null'] },
    hp: { type: ['integer', 'null'] },
    illustrator: { type: ['string', 'null'] },
  },
} as const;

const READ_PROMPT = `This photo shows a Pokémon trading card, usually a Japanese one, possibly in a sleeve. Transcribe what is printed on it. Accuracy matters more than completeness: use null for anything you cannot read with certainty, never guess.

- set_code: the small expansion code in the bottom-left corner, right of the regulation mark letter (e.g. "G", "H", "I", "J"). Examples: "SV2a", "sv4a", "M2", "M2a", "S12a", "SM12a", "svHM". Copy letters and capitalisation exactly as printed; do not include the regulation mark.
- number: the collector number next to it, e.g. "201/165", "011/053", "116/080". Keep leading zeros; include the part after the slash.
- name: the card name at the top, exactly as printed (Japanese for Japanese cards), including suffixes such as "ex", "V", "VMAX", "VSTAR", "GX". Do not include the evolution stage or HP.
- rarity: the rarity code printed after the number (C, U, R, RR, RRR, AR, SR, SAR, UR, HR, MUR, ACE, ...), or null.
- hp: the HP number at the top right for Pokémon cards, else null.
- illustrator: the name after "Illus." at the bottom left, else null.
- language: the card's print language.`;

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['match', 'confidence'],
  properties: {
    match: { type: ['integer', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
} as const;

const VERIFY_PROMPT = (n: number) => `Image 1 is a photo of a Pokémon card. Images 2 to ${n + 1} are reference images of candidate cards, numbered 1 to ${n}.
Which candidate is the same card as in the photo? It must be the same printing: same artwork (full-art vs. regular frame), same name, same collector number and set code if legible. Lighting, sleeves and glare in the photo don't matter.
Answer "match" with the candidate number (1-${n}), or null if none of them is the same printing. Use confidence "high" only if artwork and printed details clearly agree.`;

let client: Anthropic | null = null;

export const identifyConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export function anthropic(): Anthropic {
  // Organization-level API keys (not scoped to a workspace) must name the workspace per request.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  client ??= new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  return client;
}

export type ImageMedia = 'image/jpeg' | 'image/png' | 'image/webp';

type Effort = 'low' | 'medium' | 'high';

/**
 * One structured call. Speed matters here (someone is holding a card up to the camera), so it
 * runs in fast mode (same model, faster output); when fast mode is rate-limited or unavailable
 * it is repeated at standard speed.
 */
export async function structured<T>(
  content: Anthropic.Beta.BetaContentBlockParam[],
  schema: object,
  effort: Effort,
  opts: { fast?: boolean; maxTokens?: number } = {},
): Promise<T> {
  const params = {
    model: 'claude-opus-5-5',
    max_tokens: opts.maxTokens ?? 4000,
    fallbacks: 'default' as const,
    output_config: { effort, format: { type: 'json_schema' as const, schema: schema as Record<string, unknown> } },
    messages: [{ role: 'user' as const, content }],
  };
  const standard = () => anthropic().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'] });
  const response =
    opts.fast === false
      ? await standard()
      : await anthropic()
          .beta.messages.create({ ...params, speed: 'fast', betas: ['server-side-fallback-2026-07-01', 'fast-mode-2026-02-01'] })
          .catch((e) => {
            if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.BadRequestError || e instanceof Anthropic.PermissionDeniedError) return standard();
            throw e;
          });
  if (response.stop_reason === 'refusal') throw new Error('Die Erkennung wurde für dieses Bild abgelehnt');
  recordUsage(response.model, response.usage);
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('Keine Antwort der Erkennung');
  return JSON.parse(text) as T;
}

export function readCard(imageBase64: string, mediaType: ImageMedia): Promise<CardReading> {
  return structured<CardReading>(
    [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: READ_PROMPT },
    ],
    READ_SCHEMA,
    // Transcribing printed text needs little deliberation; low effort is much faster.
    'low',
  );
}

// ---------- candidate matching ----------

/** Normalise names: full-width → ASCII, no spaces, case-insensitive ("リザードン ＥＸ" = "リザードンex"). */
export const normName = (s: string) => s.normalize('NFKC').replace(/[\s・･]/g, '').toLowerCase();

interface Candidate {
  summary: CardSummary;
  hp: number | null;
  illustrator: string | null;
  image: string | null; // full URL for the visual check
}

const fromRaw = (raw: RawCard): Candidate => {
  const summary = toSummary(raw);
  // The low-resolution artwork is plenty to compare illustrations and keeps the check fast.
  return { summary, hp: raw.hp ?? null, illustrator: raw.illustrator ?? null, image: raw.image ? `${raw.image}/low.webp` : null };
};

function parseNumber(n: string | null) {
  const m = n?.normalize('NFKC').replace(/\s/g, '').match(/^(\d{1,3})(?:\/(\d{1,3}))?/);
  return m ? { n: Number(m[1]), total: m[2] ? Number(m[2]) : null, raw: m[0] } : null;
}

async function collectCandidates(r: CardReading): Promise<Candidate[]> {
  const num = parseNumber(r.number);
  const out = new Map<string, Candidate>();
  const addRaw = (raw: RawCard | null) => raw && !out.has(raw.id) && out.set(raw.id, fromRaw(raw));
  const nameMatches = () => !!r.name && [...out.values()].some((c) => normName(c.summary.nameJa) === normName(r.name!));

  const setId = r.set_code ? await resolveSetId(r.set_code.normalize('NFKC')) : null;

  await Promise.all([
    // 1. Exact set + number.
    (async () => {
      if (!setId || !num) return;
      const ids = [String(num.n).padStart(3, '0'), String(num.n)].map((l) => `${setId}-${l}`);
      const raws = await Promise.all(ids.map((id) => getRawCard(id).catch(() => null)));
      addRaw(raws.find(Boolean) ?? null);
    })(),
    // 2. Same number in every set with that printed total.
    (async () => {
      if (!num?.total) return;
      const sets = (await listSets()).filter((s) => printedTotal(s.id, s.cardCount.official) === num.total).map((s) => s.id);
      const cards = await cardsByNumber(sets, String(num.n));
      await mapLimit(cards, 8, async (c) => addRaw(await getRawCard(c.id).catch(() => null)));
    })(),
    // 4. Products TCGdex doesn't list (decks, build sets): SNKRDUNK knows them by set code + number.
    (async () => {
      if (!r.set_code || !num || setId) return;
      const printed = num.raw.includes('/') ? num.raw : String(num.n).padStart(3, '0');
      const hit = await findSnkrdunk(r.set_code, printed).catch(() => null);
      const hits = hit ? [hit] : r.name ? await searchSnkrdunk(`${r.name} ${printed}`).catch(() => []) : [];
      for (const h of hits.slice(0, 4)) {
        const s = externalSummary(h);
        if (s && !out.has(s.id)) out.set(s.id, { summary: s, hp: null, illustrator: null, image: h.image });
      }
    })(),
  ]);
  // 3. Every printing with this name — only needed when set and number found nothing with that name.
  if (r.name && !nameMatches()) {
    const briefs = await searchCards({ name: `eq:${r.name.normalize('NFKC').replace(/\s/g, '')}` }, 60).catch(() => []);
    const loose = briefs.length ? [] : await searchCards({ name: r.name }, 40).catch(() => []);
    await mapLimit([...briefs, ...loose].slice(0, 60), 10, async (b) => addRaw(await getRawCard(b.id).catch(() => null)));
  }
  return [...out.values()];
}

interface Scored extends Candidate {
  score: number;
  checks: { name: boolean; number: boolean; total: boolean; set: boolean; hp: boolean | null; illustrator: boolean | null };
}

function score(r: CardReading, c: Candidate): Scored {
  const num = parseNumber(r.number);
  const cNum = parseNumber(c.summary.number);
  const checks = {
    name: !!r.name && normName(c.summary.nameJa) === normName(r.name),
    number: !!num && !!cNum && num.n === cNum.n,
    total: !!num?.total && !!cNum?.total && num.total === cNum.total,
    set: !!r.set_code && c.summary.setId.toLowerCase() === r.set_code.normalize('NFKC').toLowerCase(),
    hp: r.hp != null && c.hp != null ? r.hp === c.hp : null,
    illustrator: r.illustrator && c.illustrator ? normName(r.illustrator) === normName(c.illustrator) : null,
  };
  const s =
    (checks.name ? 6 : 0) +
    (checks.number ? 4 : 0) +
    (checks.total ? 1 : 0) +
    (checks.set ? 4 : 0) +
    (checks.hp === true ? 1 : checks.hp === false ? -5 : 0) +
    (checks.illustrator === true ? 1 : checks.illustrator === false ? -2 : 0);
  return { ...c, score: s, checks };
}

export async function imageBlock(url: string): Promise<Anthropic.Beta.BetaContentBlockParam | null> {
  try {
    const res = await request(url, {}, 10000, 1);
    const type = res.headers.get('content-type')?.split(';')[0] ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { type: 'image', source: { type: 'base64', media_type: type as ImageMedia, data } };
  } catch {
    return null;
  }
}

/** Ask Claude which candidate image shows the same printing as the photo. */
async function visualCheck(photo: { data: string; media: ImageMedia }, cands: Scored[]) {
  const blocks = await Promise.all(cands.map((c) => (c.image ? imageBlock(c.image) : Promise.resolve(null))));
  const usable = cands.map((c, i) => ({ c, block: blocks[i] })).filter((x) => x.block);
  if (!usable.length) return null;
  const verdict = await structured<{ match: number | null; confidence: Confidence }>(
    [
      { type: 'image', source: { type: 'base64', media_type: photo.media, data: photo.data } },
      ...usable.map((u) => u.block!),
      { type: 'text', text: VERIFY_PROMPT(usable.length) },
    ],
    VERIFY_SCHEMA,
    'medium',
  );
  const picked = verdict.match != null ? usable[verdict.match - 1]?.c ?? null : null;
  return { picked, confidence: verdict.confidence, compared: usable.map((u) => u.c) };
}

/** Progress of a recognition, streamed to the app while it waits. */
export type IdentifyProgress =
  | { stage: 'reading' }
  | { stage: 'read'; reading: CardReading }
  | { stage: 'searching' }
  | { stage: 'candidates'; candidates: { name: string; number: string; setId: string; image: string | null }[] }
  | { stage: 'verifying' }
  | { stage: 'done'; result: IdentifyResult }
  | { stage: 'error'; error: string };

export async function matchReading(
  r: CardReading,
  photo?: { data: string; media: ImageMedia },
  progress: (e: IdentifyProgress) => void = () => {},
): Promise<IdentifyResult> {
  const empty = (note: string): IdentifyResult => ({ reading: r, matches: [], confidence: 'low', note, checks: null, matchedBy: 'none' });
  if (!r.is_pokemon_card) return empty('Auf dem Foto wurde keine Pokémon-Karte erkannt.');
  if (!r.name && !r.number) return empty('Name und Nummer waren nicht lesbar. Bitte näher und ohne Spiegelung fotografieren.');

  progress({ stage: 'searching' });
  const scored = (await collectCandidates(r)).map((c) => score(r, c));
  // The name is the most robust fact on the card: never offer a card with a different name.
  const pool = r.name ? scored.filter((c) => c.checks.name) : scored.filter((c) => c.checks.number && (c.checks.set || c.checks.total));
  pool.sort((a, b) => b.score - a.score);
  if (!pool.length) {
    return empty(
      r.name
        ? `„${r.name}“${r.set_code ? ` (${r.set_code} ${r.number ?? ''})` : ''} wurde in keiner Datenbank gefunden. Bitte über die Suche auswählen.`
        : 'Keine passende Karte gefunden.',
    );
  }

  const top = pool[0];
  const exact = top.checks.name && top.checks.number && (top.checks.set || top.checks.total) && top.checks.hp !== false;
  const tie = pool.length > 1 && pool[1].score === top.score;
  let confidence: Confidence = exact && !tie ? 'high' : top.checks.number || top.checks.set ? 'medium' : 'low';
  let ordered = pool;
  let visual: boolean | null = null;
  let note: string | null = null;

  progress({
    stage: 'candidates',
    candidates: pool.slice(0, 6).map((c) => ({ name: c.summary.nameEn ?? c.summary.nameJa, number: c.summary.number, setId: c.summary.setId, image: c.image })),
  });

  // When name, number and set/total all agree with exactly one card, the printed facts already
  // identify it; the image comparison is only needed when something is open.
  const settled = confidence === 'high' && pool.filter((c) => c.checks.number && (c.checks.set || c.checks.total)).length === 1;
  if (photo && !settled) {
    progress({ stage: 'verifying' });
    // Reference images for cards TCGdex has no artwork for: SNKRDUNK's product photo.
    await mapLimit(pool.slice(0, 4), 4, async (c) => {
      if (!c.image) c.image = (await findSnkrdunk(c.summary.setId, c.summary.number).catch(() => null))?.image ?? null;
    });
    const v = await visualCheck(photo, pool.slice(0, 4)).catch(() => null);
    if (v) {
      if (v.picked) {
        visual = v.picked === top;
        ordered = [v.picked, ...pool.filter((c) => c !== v.picked)];
        if (v.picked !== top) {
          confidence = 'medium';
          note = 'Bild und aufgedruckte Daten passen nicht ganz zusammen – bitte die Karte prüfen.';
        } else if (v.confidence !== 'high' && confidence === 'high') {
          confidence = 'medium';
        }
      } else {
        visual = false;
        confidence = 'low';
        note = 'Keiner der Treffer sieht genauso aus wie deine Karte (andere Version/Illustration?). Bitte auswählen oder suchen.';
      }
    }
  }
  if (!note && confidence !== 'high') {
    const missing = [!top.checks.set && 'Set', !top.checks.number && 'Nummer', top.checks.hp === false && 'KP'].filter(Boolean);
    note = missing.length ? `Nicht bestätigt: ${missing.join(', ')}. Bitte prüfen.` : 'Mehrere Versionen möglich – bitte prüfen.';
  }
  if (ordered[0].summary.id.startsWith('snk-')) {
    note = `${note ? note + ' ' : ''}Dieses Produkt fehlt in der Kartendatenbank; Preise kommen von SNKRDUNK, Cardmarket-Preis nicht verfügbar.`;
  }

  const best = ordered[0];
  return {
    reading: r,
    matches: ordered.slice(0, 12).map((c) => ({ ...c.summary, externalImage: c.summary.externalImage ?? (c.summary.image ? null : c.image) })),
    confidence,
    note,
    checks: { name: best.checks.name, number: best.checks.number, set: best.checks.set, hp: best.checks.hp, visual },
    matchedBy: best.checks.set && best.checks.number ? 'set+number' : best.checks.number ? 'number' : 'name',
  };
}

/** Exposed for tests: the printed number of a TCGdex card as shown on the card. */
export const printedNumber = (raw: RawCard) => formatNumber(raw.localId, printedTotal(raw.set.id, raw.set.cardCount?.official));
