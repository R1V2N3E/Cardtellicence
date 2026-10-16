import type Anthropic from '@anthropic-ai/sdk';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Opportunity, SealedItem } from '../../lib/types';
import { loadOpportunities } from '../api';
import { runAgent } from '../ai/agent';
import { answerConfirmation, CONFIRM_EVENT, declineAll, decision, isPending } from '../ai/confirm';
import { contextText } from '../ai/context';
import { Markdown } from '../ai/Markdown';
import { cleanFact, clearChat, readChat, removeMemory, useMemory, writeChat, type ApiMessage } from '../ai/store';
import { Header, Thumb } from '../components/ui';
import { fmtEur, fmtJpy } from '../format';

type Block = Anthropic.Beta.BetaContentBlock;
type ToolUse = Extract<Block, { type: 'tool_use' }>;

export const AI_SUGGESTIONS: { icon: string; text: string }[] = [
  { icon: '💴', text: 'Was sind gerade die besten Deals aus Japan unter 100 €?' },
  { icon: '📈', text: 'Welche Sets steigen gerade – und welche Karten darin hinken noch hinterher?' },
  { icon: '🗾', text: 'Ich bin nächste Woche in Tokio mit 1.500 € Budget. Was soll ich kaufen?' },
  { icon: '💼', text: 'Wie steht mein Portfolio da und was sollte ich jetzt verkaufen?' },
  { icon: '🧾', text: 'Welche meiner Karten werden bald steuerfrei und wie viel Freigrenze habe ich noch?' },
  { icon: '✍️', text: 'Schreib mir ein Inserat für meine wertvollste Karte – auf dem Kanal, der am meisten bringt.' },
  { icon: '🔁', text: 'Welche Karten kann ich hier kaufen und an Card Rush in Japan teurer verkaufen?' },
  { icon: '🏮', text: 'Was ist in Japan viel mehr wert als bei uns – wo könnte Cardmarket nachziehen?' },
];

export const AI_TOOLS = [
  { to: '/scan?mode=shop', icon: '🏪', title: 'Vitrine scannen', sub: 'Alle Karten + Preisschilder → Ampel' },
  { to: '/scan?mode=condition', icon: '🔬', title: 'Zustand & Echtheit', sub: 'Zentrierung, PSA-10-Chance, Fake-Check' },
  { to: '/scan', icon: '📷', title: 'Karte erkennen', sub: 'Eine Karte scannen' },
];

const TOOL_LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  search_cards: (i) => `🔎 ${String(i.query ?? 'Karten')}`,
  card_details: (i) => `💹 Live-Preise ${String(i.id ?? '')}`,
  compute_margin: () => '🧮 Marge gerechnet',
  market_overview: (i) => `📊 Markt${i.set_id ? ` ${String(i.set_id)}` : ''}`,
  find_opportunities: (i) => `✨ Chancen: ${String(i.kind ?? '')}`,
  portfolio: () => '💼 Portfolio gelesen',
  sell_options: (i) => `🏷️ Verkaufswege ${String(i.id ?? '')}`,
  tax_overview: () => '🧾 Steuerstatus',
};

const ACTION_ICON: Record<string, string> = { watch_add: '👁️', collection_add: '➕', sale_record: '💶', alert_add: '🔔', remember: '🧠' };
const ACTION_TITLE: Record<string, string> = {
  watch_add: 'Zur Watchlist',
  collection_add: 'Zur Sammlung',
  sale_record: 'Verkauf eintragen',
  alert_add: 'Preisalarm',
  remember: 'Merken',
};

/** Undo a half-finished exchange so the conversation stays valid for the next question. */
function repair(m: ApiMessage[]): { messages: ApiMessage[]; unsent: string | null } {
  const last = m[m.length - 1];
  if (!last) return { messages: m, unsent: null };
  if (last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'text')) {
    const text = last.content.filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text' && !b.text.startsWith('<app_kontext>')).map((b) => b.text).join('\n');
    return { messages: m.slice(0, -1), unsent: text };
  }
  if (last.role === 'assistant' && Array.isArray(last.content)) {
    const uses = last.content.filter((b) => b.type === 'tool_use') as ToolUse[];
    if (uses.length)
      return {
        messages: [...m, { role: 'user', content: uses.map((u) => ({ type: 'tool_result' as const, tool_use_id: u.id, is_error: true, content: 'Abgebrochen' })) }],
        unsent: null,
      };
  }
  return { messages: m, unsent: null };
}

export function Ai() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ctx = params.get('ctx');
  const [messages, setMessages] = useState<ApiMessage[]>(readChat);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [, force] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);
  const [catalog, setCatalog] = useState<Map<string, Opportunity | SealedItem>>(new Map());
  const [fx, setFx] = useState<number | null>(null);

  useEffect(() => {
    loadOpportunities()
      .then((d) => {
        setCatalog(new Map<string, Opportunity | SealedItem>([...d.items.map((o) => [o.id, o] as const), ...(d.sealed ?? []).map((s) => [s.id, s] as const)]));
        setFx(d.fx.jpyToEur);
      })
      .catch(() => {});
    const on = () => force((n) => n + 1);
    window.addEventListener(CONFIRM_EVENT, on);
    return () => {
      window.removeEventListener(CONFIRM_EVENT, on);
      abort.current?.abort();
      declineAll();
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, draft.length > 0, status, running]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || running) return;
    setError(null);
    setInput('');
    const user: ApiMessage = { role: 'user', content: [{ type: 'text', text: await contextText(ctx) }, { type: 'text', text: q }] };
    let convo = [...messages, user];
    setMessages(convo);
    writeChat(convo);
    setRunning(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      convo = await runAgent(
        convo,
        {
          onMessages: (m) => {
            convo = m;
            setMessages(m);
            writeChat(m);
          },
          onDraft: setDraft,
          onStatus: setStatus,
        },
        ac.signal,
      );
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      const fixed = repair(convo);
      convo = fixed.messages;
      setMessages(convo);
      if (fixed.unsent) setInput(fixed.unsent);
    } finally {
      writeChat(convo);
      setRunning(false);
      setDraft('');
      setStatus(null);
      abort.current = null;
    }
  };

  // ?q= from the search page or a context button: ask right away.
  useEffect(() => {
    const q = params.get('q');
    if (q && !autoSent.current) {
      autoSent.current = true;
      const next = new URLSearchParams(params);
      next.delete('q');
      setParams(next, { replace: true });
      void send(q);
    }
  }, []);

  const stop = () => {
    declineAll();
    abort.current?.abort();
  };

  const reset = () => {
    stop();
    clearChat();
    setMessages([]);
    setError(null);
  };

  // tool_use id → parsed result (to show what a confirmation turned into)
  const results = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const m of messages)
      if (m.role === 'user' && Array.isArray(m.content))
        for (const b of m.content)
          if (b.type === 'tool_result' && typeof b.content === 'string')
            try {
              map.set(b.tool_use_id, JSON.parse(b.content));
            } catch {
              map.set(b.tool_use_id, { status: b.is_error ? 'error' : 'done' });
            }
    return map;
  }, [messages]);

  const empty = !messages.length;

  return (
    <div className="ai-page">
      <Header
        title="Cardtelligence KI"
        sub={ctx ? contextLabel(ctx) : 'Markt · Deals · Portfolio · Verkauf · Steuer'}
        back
        right={
          !empty ? (
            <button className="icon-btn" onClick={reset} aria-label="Neue Unterhaltung">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          ) : undefined
        }
      />

      {empty && <Welcome onAsk={send} />}

      <div className="ai-thread">
        {messages.map((m, idx) => (
          <MessageView key={idx} m={m} catalog={catalog} fx={fx} results={results} navigate={navigate} />
        ))}
        {running && draft && (
          <div className="ai-msg bot">
            <Markdown text={draft} />
          </div>
        )}
        {running && (
          <div className="ai-status">
            <span className="ai-orb small" />
            <span>{status ?? 'Schreibt …'}</span>
          </div>
        )}
        {error && <div className="error-box">⚠︎ {error}</div>}
        <div ref={bottom} />
      </div>

      <Composer value={input} onChange={setInput} onSend={() => send(input)} running={running} onStop={stop} />
    </div>
  );
}

function contextLabel(ctx: string) {
  if (ctx.startsWith('card:')) return `Zur Karte ${ctx.slice(5)}`;
  if (ctx.startsWith('set:')) return `Zum Set ${ctx.slice(4)}`;
  return { portfolio: 'Zu deinem Portfolio', deals: 'Zu den Deals', market: 'Zum Markt' }[ctx] ?? 'Cardtelligence';
}

function Welcome({ onAsk }: { onAsk: (q: string) => void }) {
  const [memory] = useMemory();
  return (
    <div className="ai-welcome">
      <div className="ai-hero">
        <span className="ai-orb" />
        <h2>Frag mich alles rund um deine Karten.</h2>
        <p>Ich rechne mit Live-Preisen aus Japan und Europa, deinen Kosten-Einstellungen und deiner Sammlung.</p>
      </div>
      <div className="ai-suggest">
        {AI_SUGGESTIONS.map((s) => (
          <button key={s.text} className="ai-sugg" onClick={() => onAsk(s.text)}>
            <span>{s.icon}</span>
            {s.text}
          </button>
        ))}
      </div>
      <h3 className="section-h">Kamera-Werkzeuge</h3>
      <div className="ai-tools">
        {AI_TOOLS.map((t) => (
          <Link key={t.to} to={t.to} className="ai-tool">
            <span className="ai-tool-icon">{t.icon}</span>
            <b>{t.title}</b>
            <small>{t.sub}</small>
          </Link>
        ))}
      </div>
      {memory.length > 0 && (
        <>
          <h3 className="section-h">Was ich mir gemerkt habe</h3>
          <ul className="ai-memory">
            {memory.map((m) => (
              <li key={m.id}>
                <span>{m.text}</span>
                <button className="link-btn" onClick={() => removeMemory(m.id)} aria-label="Vergessen">
                  Vergessen
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MessageView({
  m,
  catalog,
  fx,
  results,
  navigate,
}: {
  m: ApiMessage;
  catalog: Map<string, Opportunity | SealedItem>;
  fx: number | null;
  results: Map<string, Record<string, unknown>>;
  navigate: (to: string) => void;
}) {
  if (m.role === 'user') {
    if (typeof m.content === 'string') return <div className="ai-msg me">{m.content}</div>;
    const text = m.content
      .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text' && !b.text.startsWith('<app_kontext>'))
      .map((b) => b.text)
      .join('\n');
    return text ? <div className="ai-msg me">{text}</div> : null;
  }
  if (typeof m.content === 'string') return <div className="ai-msg bot"><Markdown text={m.content} /></div>;
  const out: ReactNode[] = [];
  let chips: ReactNode[] = [];
  const flushChips = () => {
    if (chips.length) out.push(<div className="ai-chips" key={`c${out.length}`}>{chips}</div>);
    chips = [];
  };
  const blocks = m.content as Block[];
  blocks.forEach((b, i) => {
    if (b.type === 'text') {
      flushChips();
      if (b.text.trim()) out.push(<div className="ai-msg bot" key={i}><Markdown text={b.text} /></div>);
    } else if (b.type === 'tool_use') {
      const input = b.input as Record<string, unknown>;
      if (b.name === 'show_cards') {
        flushChips();
        out.push(<CardTiles key={i} ids={(input.ids as string[]) ?? []} title={input.title as string | undefined} catalog={catalog} fx={fx} />);
      } else if (b.name === 'propose_action') {
        flushChips();
        out.push(<ConfirmCard key={i} id={b.id} input={input} result={results.get(b.id)} catalog={catalog} />);
      } else if (b.name === 'open_tool') {
        flushChips();
        const tool = String(input.tool);
        const to = tool === 'shop' ? '/scan?mode=shop' : tool === 'condition' ? `/scan?mode=condition${input.card_id ? `&card=${encodeURIComponent(String(input.card_id))}` : ''}` : '/scan';
        const t = AI_TOOLS.find((x) => x.to.split('&')[0] === to.split('&')[0]) ?? AI_TOOLS[2];
        out.push(
          <button key={i} className="ai-tool wide" onClick={() => navigate(to)}>
            <span className="ai-tool-icon">{t.icon}</span>
            <b>{(input.label as string) || t.title}</b>
            <small>{t.sub}</small>
          </button>,
        );
      } else chips.push(<span className="ai-chip" key={i}>{TOOL_LABEL[b.name]?.(input) ?? b.name}</span>);
    } else if (b.type === 'server_tool_use') {
      const q = (b.input as { query?: string }).query;
      chips.push(<span className="ai-chip" key={i}>🌐 {q ?? 'Websuche'}</span>);
    } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content.slice(0, 3)) {
        if (r.type !== 'web_search_result') continue;
        // Only plain web links (never javascript: or data: URLs).
        const u = safeUrl(r.url);
        if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) continue;
        chips.push(
          <a className="ai-chip src" key={`${i}-${r.url}`} href={u.href} target="_blank" rel="noopener noreferrer">
            {u.hostname.replace(/^www\./, '')}
          </a>,
        );
      }
    }
  });
  flushChips();
  return <>{out}</>;
}

function CardTiles({ ids, title, catalog, fx }: { ids: string[]; title?: string; catalog: Map<string, Opportunity | SealedItem>; fx: number | null }) {
  return (
    <div className="ai-cards">
      {title && <div className="ai-cards-title">{title}</div>}
      <div className="ai-cards-row">
        {ids.slice(0, 12).map((id) => {
          const c = catalog.get(id);
          const sealed = c && 'kind' in c;
          const name = c ? (sealed ? (c as SealedItem).nameEn : ((c as Opportunity).nameEn ?? (c as Opportunity).nameJa)) : id;
          const body = (
            <>
              <Thumb id={id} image={c && !sealed ? (c as Opportunity).image : null} fallback={sealed ? (c as SealedItem).image : (c as Opportunity | undefined)?.snkImg} alt={name} />
              <b>{name}</b>
              <small>{c ? `${c.setId}${!sealed ? ` ${(c as Opportunity).number}` : ''}` : ''}</small>
              {c?.cmTrend != null && <span className="ai-card-eur">🇩🇪 {fmtEur(c.cmTrend)}</span>}
              {c?.crJpy ? (
                <span className="ai-card-jpy">
                  🇯🇵 {fmtJpy(c.crJpy)}
                  {fx ? ` · ${fmtEur(c.crJpy * fx)}` : ''}
                </span>
              ) : null}
            </>
          );
          return sealed ? (
            <div key={id} className="ai-card">{body}</div>
          ) : (
            <Link key={id} to={`/card/${encodeURIComponent(id)}`} className="ai-card">
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const safeUrl = (s: string) => {
  try {
    return new URL(s);
  } catch {
    return null;
  }
};

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What the action will really do, from its parameters — not from the model's own summary. */
function actionDetails(input: Record<string, unknown>, catalog: Map<string, Opportunity | SealedItem>): string[] {
  const id = typeof input.card_id === 'string' ? input.card_id : null;
  const c = id ? catalog.get(id) : undefined;
  const card = id ? `${c ? ('kind' in c ? c.nameEn : ((c as Opportunity).nameEn ?? (c as Opportunity).nameJa)) + ' · ' : ''}${id}` : '–';
  const qty = Math.max(1, Math.round(n(input.qty) ?? 1));
  switch (input.action) {
    case 'watch_add':
      return [`Karte: ${card}`];
    case 'collection_add':
      return [
        `Karte: ${card}`,
        `Anzahl: ${qty} · Zustand: ${typeof input.condition === 'string' ? input.condition : 'NM'}`,
        n(input.cost_amount) ? `Einkauf: ${input.cost_currency === 'EUR' ? fmtEur(n(input.cost_amount)) : fmtJpy(n(input.cost_amount))} / Stück` : 'Einkauf: nicht angegeben',
      ];
    case 'sale_record':
      return [
        `Karte: ${card}`,
        `Entfernt ${qty} Stück aus deiner Sammlung`,
        `Preis: ${n(input.price_eur) != null ? fmtEur(n(input.price_eur)) : '–'} / Stück · Gebühren: ${fmtEur(n(input.fees_eur) ?? 0)}`,
        `Kanal: ${typeof input.channel === 'string' ? input.channel.slice(0, 40) : 'unbekannt'}`,
      ];
    case 'alert_add':
      return [
        `Karte: ${card}`,
        ...(n(input.below_eur) != null ? [`Alarm unter ${fmtEur(n(input.below_eur))}`] : []),
        ...(n(input.above_eur) != null ? [`Alarm über ${fmtEur(n(input.above_eur))}`] : []),
        ...(n(input.cr_buy_above_jpy) != null ? [`Alarm Card-Rush-Ankauf über ${fmtJpy(n(input.cr_buy_above_jpy))}`] : []),
      ];
    case 'remember':
      return [`Speichert dauerhaft: „${cleanFact(typeof input.fact === 'string' ? input.fact : '')}“`];
  }
  return ['Unbekannte Aktion – nicht bestätigen'];
}

function ConfirmCard({ id, input, result, catalog }: { id: string; input: Record<string, unknown>; result?: Record<string, unknown>; catalog: Map<string, Opportunity | SealedItem> }) {
  const action = String(input.action);
  const pending = isPending(id);
  const state = result?.status ?? (decision(id) === true ? 'confirmed' : decision(id) === false ? 'declined' : pending ? 'pending' : 'expired');
  return (
    <div className={`ai-confirm ${state}`}>
      <div className="ai-confirm-head">
        <span>{ACTION_ICON[action] ?? '✳️'}</span>
        <b>{ACTION_TITLE[action] ?? action}</b>
      </div>
      <p>{String(input.summary ?? '').slice(0, 300)}</p>
      <ul className="ai-confirm-facts">
        {actionDetails(input, catalog).map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      {state === 'pending' ? (
        <div className="ai-confirm-btns">
          <button className="ghost-btn" onClick={() => answerConfirmation(id, false)}>
            Nein
          </button>
          <button className="primary-btn" onClick={() => answerConfirmation(id, true)}>
            Bestätigen
          </button>
        </div>
      ) : (
        <div className="ai-confirm-state">
          {state === 'confirmed' ? '✓ Erledigt' : state === 'declined' ? 'Abgelehnt' : state === 'error' ? 'Fehlgeschlagen' : 'Nicht mehr offen'}
        </div>
      )}
    </div>
  );
}

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function Composer({ value, onChange, onSend, running, onStop }: { value: string; onChange: (v: string) => void; onSend: () => void; running: boolean; onStop: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [listening, setListening] = useState(false);
  const rec = useRef<InstanceType<SpeechCtor> | null>(null);
  const Speech = (window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [value]);

  const listen = () => {
    if (!Speech) return;
    if (listening) return rec.current?.stop();
    const r = new Speech();
    r.lang = 'de-DE';
    r.interimResults = true;
    const base = value ? value + ' ' : '';
    r.onresult = (e) => onChange(base + Array.from(e.results).map((x) => x[0].transcript).join(''));
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <div className="ai-composer">
      <textarea
        ref={ref}
        rows={1}
        placeholder="Frag nach Preisen, Deals, deiner Sammlung …"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      {Speech && !running && (
        <button className={`ai-mic ${listening ? 'on' : ''}`} onClick={listen} aria-label="Spracheingabe">
          <svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
      )}
      {running ? (
        <button className="ai-send stop" onClick={onStop} aria-label="Stoppen">
          <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
        </button>
      ) : (
        <button className="ai-send" onClick={onSend} disabled={!value.trim()} aria-label="Senden">
          <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      )}
    </div>
  );
}
