// The agent loop in the app: send the conversation, stream the reply, run the tools Claude asks
// for here on the device, send the results back — until Claude has answered.
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent } from '../../lib/agent';
import { ApiError } from '../api';
import { readAccessCode } from '../state';
import type { ApiMessage } from './store';
import { runTool } from './tools';

type Block = Anthropic.Beta.BetaContentBlock;
export type ToolUse = Extract<Block, { type: 'tool_use' }>;

export interface LoopCallbacks {
  /** The conversation changed (new assistant turn, tool results). */
  onMessages: (m: ApiMessage[]) => void;
  /** Text of the reply being written right now (reset on each new turn). */
  onDraft: (text: string) => void;
  onStatus: (s: string | null) => void;
}

const MAX_TURNS = 14;

async function turn(messages: ApiMessage[], cb: LoopCallbacks, signal: AbortSignal): Promise<{ content: Block[]; stop: string | null }> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-code': readAccessCode() },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      body.error ?? String(res.status),
      body.error === 'access_code'
        ? 'Zugangscode fehlt oder ist falsch – in den Einstellungen eintragen.'
        : body.error === 'not_configured'
          ? 'Die KI ist auf dem Server nicht eingerichtet (API-Schlüssel fehlt).'
          : (body.error ?? `Fehler ${res.status}`),
    );
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let draft = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line) as AgentEvent;
      if (e.t === 'text') {
        draft += e.d;
        cb.onDraft(draft);
        cb.onStatus(null);
      } else if (e.t === 'status') cb.onStatus(e.d.length > 90 ? e.d.slice(0, 88) + ' …' : e.d);
      else if (e.t === 'error') throw new Error(e.error);
      else if (e.t === 'done') return { content: e.content, stop: e.stop };
    }
  }
  throw new Error('Die Verbindung wurde unterbrochen – bitte nochmal versuchen.');
}

/** Run the conversation until Claude stops; returns the full conversation. */
export async function runAgent(start: ApiMessage[], cb: LoopCallbacks, signal: AbortSignal): Promise<ApiMessage[]> {
  let messages = start;
  for (let i = 0; i < MAX_TURNS; i++) {
    cb.onDraft('');
    cb.onStatus(i === 0 ? 'Denkt nach …' : 'Wertet aus …');
    const { content, stop } = await turn(messages, cb, signal);
    // Assistant turns go back exactly as received (thinking blocks included).
    messages = [...messages, { role: 'assistant', content }];
    cb.onDraft('');
    cb.onMessages(messages);
    if (stop === 'refusal') throw new Error('Diese Anfrage kann die KI nicht beantworten.');
    if (stop === 'pause_turn') continue; // web search paused mid-turn: continue it
    const uses = content.filter((b): b is ToolUse => b.type === 'tool_use');
    if (stop !== 'tool_use' || !uses.length) {
      cb.onStatus(null);
      return messages;
    }
    cb.onStatus(statusFor(uses));
    // All results of one turn go back in a single message.
    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          return { type: 'tool_result', tool_use_id: u.id, content: await runTool(u.name, u.input as Record<string, unknown>, u.id) };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    messages = [...messages, { role: 'user', content: results }];
    cb.onMessages(messages);
  }
  cb.onStatus(null);
  return messages;
}

const STATUS: Record<string, string> = {
  search_cards: 'Sucht Karten …',
  card_details: 'Holt Live-Preise …',
  compute_margin: 'Rechnet die Marge …',
  market_overview: 'Analysiert den Markt …',
  find_opportunities: 'Sucht Chancen …',
  portfolio: 'Liest deine Sammlung …',
  sell_options: 'Vergleicht Verkaufswege …',
  tax_overview: 'Prüft Haltedauer und Freigrenze …',
  propose_action: 'Wartet auf deine Bestätigung …',
};
const statusFor = (uses: ToolUse[]) => STATUS[uses.find((u) => STATUS[u.name])?.name ?? ''] ?? 'Arbeitet …';
