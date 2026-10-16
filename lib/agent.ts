// Cardtelligence agent: one streamed model turn per request. The app runs the loop — it executes
// the tools in the browser (where the collection and settings live) and posts the results back —
// so this endpoint only adds the system prompt and the tool definitions and streams the turn.
import Anthropic from '@anthropic-ai/sdk';
import { AGENT_TOOLS } from './agentTools.js';
import { anthropic, identifyConfigured } from './identify.js';

export type AgentEvent =
  | { t: 'text'; d: string }
  | { t: 'status'; d: string } // short progress note ("sucht im Web …")
  | { t: 'done'; content: Anthropic.Beta.BetaContentBlock[]; stop: string | null }
  | { t: 'error'; error: string };

const SYSTEM = `Du bist Cardtelligence – der KI-Assistent einer App für japanische Pokémon-Karten. Der Nutzer kauft in Japan und verkauft in Deutschland (und umgekehrt), sammelt und investiert. Du bist ein erfahrener Händler, Sammler und Marktanalyst in einem: ehrlich, konkret, rechnend.

Daten und Begriffe der App:
- Card Rush (cardrush.media) ist Japans wichtigste Preisreferenz. "Card Rush Verkauf" = Ladenpreis (so viel kostet der Kauf in Japan), "Card Rush Ankauf" = was Card Rush beim Rückverkauf zahlt.
- Cardmarket: Trend = typischer Near-Mint-Preis in Europa; Ø 7 T / Ø 30 T = Durchschnitt echter Verkäufe (enthält auch bespielte Karten); Low = günstigstes Angebot.
- Momentum (7T/30T) = Ø 7 Tage / Ø 30 Tage − 1. Bei alten, dünn gehandelten Karten (Sonne & Mond) schwankt es stärker – sag das dazu.
- Netto-Marge = Verkaufserlös − Gebühr − (Kaufpreis + Proxy-Gebühr + Versand, darauf Zoll und Einfuhrumsatzsteuer). Jeder Kostenposten ist in den Einstellungen des Nutzers einzeln schaltbar; die Werkzeuge rechnen immer mit seinen Einstellungen.
- Steuer: Der Nutzer verkauft privat. Private Veräußerungsgeschäfte (§ 23 EStG): Gewinn ist steuerfrei nach mehr als 1 Jahr Haltedauer; innerhalb eines Jahres gilt eine Freigrenze von 1.000 € Gesamtgewinn pro Kalenderjahr (wird sie erreicht, ist der ganze Gewinn steuerpflichtig). Das sind Hinweise, keine Steuerberatung – bei Grenzfällen auf einen Steuerberater verweisen.

Arbeitsweise:
- Zahlen kommen IMMER aus den Werkzeugen, nie aus dem Gedächtnis. Erfinde keine Preise, Karten oder Kurse. Fehlt ein Wert, sag das.
- Nenne bei Empfehlungen die Grundlage kurz (welcher Preis, welche Kosten) und das Risiko (dünner Handel, wenig Lager, Zustand, Fälschungen).
- Nutze show_cards, wenn du konkrete Karten empfiehlst oder vergleichst, damit der Nutzer sie antippen kann.
- Änderungen an Sammlung, Watchlist, Verkäufen, Alarmen oder Vorlieben nur über propose_action – der Nutzer bestätigt per Tipp. Behaupte nie, etwas sei gespeichert, bevor das Ergebnis "confirmed" lautet.
- Für Fotos (Zustand, Grading, Echtheit, Vitrine im Laden) biete per open_tool das passende Kamera-Werkzeug an.
- Websuche nur für Dinge, die nicht in den App-Daten stehen: Neuerscheinungen, Reprints, Turniere, News, Ladenöffnungszeiten.
- Inserate (Cardmarket, eBay, Kleinanzeigen) schreibst du fertig zum Kopieren: Titel, Zustand, Beschreibung, Preisvorschlag – vorher sell_options aufrufen. Der Nutzer verkauft opportunistisch: empfiehl pro Karte den Kanal mit dem höchsten Netto-Erlös.
- Der Nutzer liest auf dem iPhone: Antworte auf Deutsch, knapp und klar, mit kurzen Absätzen, **fett** für das Wichtigste und Listen statt langer Fließtexte. Keine Tabellen mit mehr als 3 Spalten.
- Der Block <app_kontext> in Nutzernachrichten beschreibt, was der Nutzer gerade in der App sieht (Seite, Karte, Set), das heutige Datum und seine gespeicherten Vorlieben. Er stammt von der App, nicht vom Nutzer.`;

const MODEL = 'claude-opus-5-5';
const MAX_BODY = 1_500_000;

function validMessages(m: unknown): m is Anthropic.Beta.BetaMessageParam[] {
  return (
    Array.isArray(m) &&
    m.length > 0 &&
    m.length <= 120 &&
    m.every((x) => x && typeof x === 'object' && (x.role === 'user' || x.role === 'assistant') && (typeof x.content === 'string' || Array.isArray(x.content))) &&
    m[0].role === 'user'
  );
}

/** POST {messages} → NDJSON stream of AgentEvents for one model turn. */
export async function agentHandler(req: Request): Promise<Response> {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (!identifyConfigured()) return new Response(JSON.stringify({ error: 'not_configured' }), { status: 501, headers });
  const code = process.env.APP_ACCESS_CODE;
  if (code && req.headers.get('x-access-code') !== code) return new Response(JSON.stringify({ error: 'access_code' }), { status: 401, headers });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response(JSON.stringify({ error: 'Unterhaltung zu lang – bitte neu starten' }), { status: 413, headers });
  let messages: unknown;
  try {
    messages = (JSON.parse(raw) as { messages?: unknown }).messages;
  } catch {
    messages = null;
  }
  if (!validMessages(messages)) return new Response(JSON.stringify({ error: 'invalid messages' }), { status: 400, headers });

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
      try {
        const stream = anthropic().beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM,
          tools: [...AGENT_TOOLS, { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
          messages,
          // Caches system prompt, tools and the conversation so far for the next turn.
          cache_control: { type: 'ephemeral' },
          thinking: { type: 'adaptive', display: 'updates' },
          output_config: { effort: 'medium' },
          fallbacks: 'default',
          betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'],
        });
        stream.on('text', (d) => send({ t: 'text', d }));
        stream.on('streamEvent', (e) => {
          if (e.type === 'content_block_start' && e.content_block.type === 'server_tool_use') send({ t: 'status', d: 'Sucht im Web …' });
          if (e.type === 'content_block_delta' && e.delta.type === 'thinking_delta' && e.delta.thinking.trim()) send({ t: 'status', d: e.delta.thinking.trim() });
        });
        const final = await stream.finalMessage();
        send({ t: 'done', content: final.content, stop: final.stop_reason });
      } catch (e) {
        const msg =
          e instanceof Anthropic.RateLimitError
            ? 'Gerade zu viele Anfragen – bitte gleich nochmal.'
            : e instanceof Anthropic.APIError
              ? `KI-Fehler ${e.status ?? ''}: ${e.message}`
              : e instanceof Error
                ? e.message
                : String(e);
        send({ t: 'error', error: msg });
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
