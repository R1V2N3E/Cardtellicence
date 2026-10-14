// Card recognition from a photo: Claude reads what is printed on the card (set code,
// collector number, name), then we resolve that to TCGdex card ids ourselves.
import Anthropic from '@anthropic-ai/sdk';
import { search } from './search.js';
import type { CardSummary } from './types.js';

export interface CardReading {
  is_pokemon_card: boolean;
  language: 'ja' | 'en' | 'other';
  set_code: string | null; // printed bottom-left, e.g. "SV2a", "M2", "S12a"
  number: string | null; // printed collector number, e.g. "201/165"
  name: string | null; // card name as printed (Japanese for Japanese cards)
  rarity: string | null; // printed rarity code, e.g. "SAR", "SR", "AR"
}

export interface IdentifyResult {
  reading: CardReading;
  matches: CardSummary[];
  matchedBy: 'set+number' | 'number' | 'name' | 'none';
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_pokemon_card', 'language', 'set_code', 'number', 'name', 'rarity'],
  properties: {
    is_pokemon_card: { type: 'boolean' },
    language: { type: 'string', enum: ['ja', 'en', 'other'] },
    set_code: { type: ['string', 'null'] },
    number: { type: ['string', 'null'] },
    name: { type: ['string', 'null'] },
    rarity: { type: ['string', 'null'] },
  },
} as const;

const PROMPT = `This photo shows a Pokémon trading card, usually a Japanese one. Read what is printed on it.

- set_code: the expansion code printed in the bottom-left corner next to the regulation mark, e.g. "SV2a", "SV8a", "M2", "M2a", "S12a", "SM12a". Copy its capitalisation exactly. null if not legible.
- number: the collector number printed next to it, e.g. "201/165" or "116/080". Keep leading zeros. null if not legible.
- name: the card name exactly as printed at the top (Japanese for Japanese cards), including suffixes like "ex", "V", "VSTAR", "GX".
- rarity: the rarity code printed after the number (C, U, R, RR, AR, SR, SAR, UR, MUR, ...), or null.
- language: the card's print language.
Report only what you can read; use null rather than guessing.`;

let client: Anthropic | null = null;

export const identifyConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function readCard(imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<CardReading> {
  // Organization-level API keys (not scoped to a workspace) must name the workspace per request.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  client ??= new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') throw new Error('Recognition was declined for this image');
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('No recognition result');
  return JSON.parse(text) as CardReading;
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Resolve a reading to Japanese card ids: exact set + number, then number/total, then name. */
export async function matchReading(r: CardReading): Promise<IdentifyResult> {
  const num = r.number?.replace(/\s/g, '').match(/^(\d{1,3})(?:\/(\d{1,3}))?/);
  const byName = (cards: CardSummary[]) =>
    r.name ? [...cards].sort((a, b) => Number(norm(b.nameJa) === norm(r.name!)) - Number(norm(a.nameJa) === norm(r.name!))) : cards;

  if (r.set_code && num) {
    const hits = await search(`${r.set_code} ${num[1]}`).catch(() => []);
    if (hits.length) return { reading: r, matches: hits, matchedBy: 'set+number' };
  }
  if (num?.[2]) {
    const hits = await search(`${num[1]}/${num[2]}`).catch(() => []);
    if (hits.length) {
      // Several sets share a total; the printed name decides.
      const named = r.name ? hits.filter((c) => norm(c.nameJa) === norm(r.name!)) : [];
      return { reading: r, matches: named.length ? [...named, ...hits.filter((c) => !named.includes(c))] : hits, matchedBy: 'number' };
    }
  }
  if (r.name) {
    const hits = await search(r.name).catch(() => []);
    if (hits.length) return { reading: r, matches: byName(hits).slice(0, 24), matchedBy: 'name' };
  }
  return { reading: r, matches: [], matchedBy: 'none' };
}
