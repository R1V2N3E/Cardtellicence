import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CardSummary, Opportunity } from '../../lib/types';
import { api, loadOpportunities } from '../api';
import { CardLink, ErrorBox, Header, Spinner, Thumb } from '../components/ui';
import { fmtEur, yuyuteiImg } from '../format';
import { readChat } from '../ai/store';
import { AI_SUGGESTIONS, AI_TOOLS } from './Ai';

/** A question or a wish rather than a card name: goes to the assistant on Enter. */
const looksLikeQuestion = (s: string) =>
  /\?\s*$/.test(s) || s.trim().split(/\s+/).length >= 4 || /^(was|wie|wo|wann|welche|welcher|warum|lohnt|soll|kann|zeig|finde|schreib|vergleich|erklär|hilf|gib|ich|mein|meine)\b/i.test(s.trim());

const EXAMPLES = ['Glurak', '116/80', 'SV2a 201', 'ピカチュウ'];
const RECENT = 'ct-recent-search';
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]');
  } catch {
    return [];
  }
};
const saveRecent = (q: string) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([q, ...readRecent().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 8)));
  } catch {
    /* optional */
  }
};

export function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [state, setState] = useState<{ results?: CardSummary[]; error?: string; loading: boolean }>({ loading: false });
  const [opps, setOpps] = useState<Map<string, Opportunity>>(new Map());

  useEffect(() => {
    loadOpportunities().then((f) => setOpps(new Map(f.items.map((o) => [o.id, o])))).catch(() => {});
  }, []);

  // Debounce typing into the URL (so back navigation restores the search).
  useEffect(() => {
    const t = setTimeout(() => input !== q && setParams(input ? { q: input } : {}, { replace: true }), 450);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    if (!q.trim()) return setState({ loading: false });
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api.search(q).then(
      (results) => {
        if (!alive) return;
        setState({ results, loading: false });
        if (results.length) saveRecent(q.trim());
      },
      (e) => alive && setState({ error: e.message, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [q]);

  // Cards the daily scan has priced first (most valuable first), then the rest.
  const results = useMemo(() => {
    const list = state.results ?? [];
    return [...list].sort((a, b) => (opps.get(b.id)?.cmTrend ?? 0) - (opps.get(a.id)?.cmTrend ?? 0));
  }, [state.results, opps]);

  return (
    <>
      <Header title="KI & Suche" sub="Karte suchen – oder einfach fragen" />
      <div className="toolbar">
        <input
          className="input big"
          type="search"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Glurak, 116/80 … oder eine Frage"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (looksLikeQuestion(input)) navigate(`/ai?q=${encodeURIComponent(input)}`);
            else setParams(input ? { q: input } : {});
          }}
        />
        {input.trim() && (
          <button className={`ai-ask ${looksLikeQuestion(input) ? 'strong' : ''}`} onClick={() => navigate(`/ai?q=${encodeURIComponent(input)}`)}>
            <span className="ai-orb small" />
            <span>
              <b>KI fragen</b>
              <small>„{input.trim()}“</small>
            </span>
            <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
        {!q && !input && <QuickSearch onPick={(ex) => (setInput(ex), setParams({ q: ex }))} />}
      </div>
      {!q && !input && <AiHub />}
      {state.loading && <Spinner label="Suche…" />}
      {state.error && <ErrorBox message={state.error} />}
      {state.results && !state.results.length && !state.loading && <p className="empty">Keine japanischen Karten für „{q}“ gefunden.</p>}
      <div className="grid">
        {results.map((c, idx) => {
          const o = opps.get(c.id);
          return (
            <CardLink
              key={c.id}
              id={c.id}
              className="grid-card"
              preview={{ card: c, image: yuyuteiImg(o?.yytUrl) ?? o?.snkImg, cardmarket: o ? { trend: o.cmTrend, avg30: o.cmAvg30, low: o.cmLow } : null }}
            >
              <Thumb eager={idx < 9} id={c.id} image={c.image} fallback={yuyuteiImg(o?.yytUrl)} alt={c.nameJa} />
              <div className="grid-name">{c.nameEn ?? c.nameJa}</div>
              <div className="grid-meta">
                {c.setId} {c.number}
              </div>
              {o?.cmTrend != null && <div className="grid-price">🇩🇪 {fmtEur(o.cmTrend)}</div>}
            </CardLink>
          );
        })}
      </div>
    </>
  );
}

function QuickSearch({ onPick }: { onPick: (q: string) => void }) {
  const [recent, setRecent] = useState(readRecent);
  const list = recent.length ? recent : EXAMPLES;
  return (
    <div className="quick-search">
      <span className="quick-label">{recent.length ? 'Zuletzt' : 'z. B.'}</span>
      <div className="quick-row">
        {list.map((ex) => (
          <button key={ex} className="quick-chip" onClick={() => onPick(ex)}>
            {ex}
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <button
          className="quick-clear"
          onClick={() => {
            localStorage.removeItem(RECENT);
            setRecent([]);
          }}
          aria-label="Verlauf löschen"
        >
          ✕
        </button>
      )}
    </div>
  );
}

const Chevron = () => (
  <svg className="hub-chevron" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

function AiHub() {
  const navigate = useNavigate();
  const hasChat = readChat().length > 0;
  const ask = (text: string) => navigate(`/ai?q=${encodeURIComponent(text)}`);
  return (
    <div className="hub">
      <h2 className="hub-title">KI-Assistent</h2>
      <section className="hub-group">
        <Link to="/ai" className="hub-ai">
          <span className="ai-orb" />
          <span className="hub-ai-text">
            <b>Cardtelligence KI</b>
            <small>{hasChat ? 'Unterhaltung fortsetzen' : 'Frag nach Preisen, Deals, deiner Sammlung, Steuern'}</small>
          </span>
          <Chevron />
        </Link>
        {AI_SUGGESTIONS.slice(0, 4).map((s) => (
          <button key={s.text} className="hub-row" onClick={() => ask(s.text)}>
            <span className="hub-icon">{s.icon}</span>
            <span className="hub-row-text">{s.short}</span>
            <Chevron />
          </button>
        ))}
        <Link to="/ai" className="hub-row more">
          <span className="hub-icon">✨</span>
          <span className="hub-row-text">Weitere Ideen</span>
          <Chevron />
        </Link>
      </section>

      <h2 className="hub-title">Kamera-Werkzeuge</h2>
      <section className="hub-group">
        {AI_TOOLS.map((t) => (
          <Link key={t.to} to={t.to} className="hub-row tall">
            <span className="hub-icon big">{t.icon}</span>
            <span className="hub-row-text">
              <b>{t.title}</b>
              <small>{t.sub}</small>
            </span>
            <Chevron />
          </Link>
        ))}
      </section>
    </div>
  );
}
