import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CardSummary, Opportunity } from '../../lib/types';
import { api, loadOpportunities } from '../api';
import { CardLink, ErrorBox, Header, Spinner, Thumb } from '../components/ui';
import { fmtEur, yuyuteiImg } from '../format';

const EXAMPLES = ['Charizard', 'Glurak', '116/80', 'SV2a 201', 'M2a', 'ピカチュウ'];

export function Search() {
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
      (results) => alive && setState({ results, loading: false }),
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
      <Header title="Suche" sub="Name (DE/EN/JP) · Nummer wie 116/80 · Set + Nummer" />
      <div className="toolbar">
        <input
          className="input big"
          type="search"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="z. B. Glurak, 116/80, SV2a 201"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setParams(input ? { q: input } : {})}
        />
        {!q && (
          <div className="chips wrap">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => (setInput(ex), setParams({ q: ex }))}>
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>
      {state.loading && <Spinner label="Suche…" />}
      {state.error && <ErrorBox message={state.error} />}
      {state.results && !state.results.length && !state.loading && <p className="empty">Keine japanischen Karten für „{q}“ gefunden.</p>}
      <div className="grid">
        {results.map((c) => {
          const o = opps.get(c.id);
          return (
            <CardLink key={c.id} id={c.id} className="grid-card">
              <Thumb id={c.id} image={c.image} fallback={yuyuteiImg(o?.yytUrl)} alt={c.nameJa} />
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
