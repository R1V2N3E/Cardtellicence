import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type LivePrice } from '../api';
import { AppBar } from '../components/AppBar';
import { PortfolioChart } from '../components/PortfolioChart';
import { CardLink, Chips, Thumb } from '../components/ui';
import { ago, fmtEur, fmtJpy, fmtSigned, marginClass } from '../format';
import { CONDITIONS, readPortfolioHistory, recordPortfolioValue, useCollection, type CollectionItem, type Condition } from '../state';
import { Watchlist } from './Watchlist';

type Tab = 'cards' | 'sealed' | 'sets' | 'watch';
const isSealed = (i: CollectionItem) => i.kind === 'sealed' || i.cardId.startsWith('cm-');
type Sort = 'value' | 'recent' | 'name' | 'profit';
const REFRESH_MS = 5 * 60_000;

// Cardmarket's price guide describes near-mint raw copies; played copies sell for less.
const CONDITION_FACTOR: Record<Condition, number> = { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, PSA10: 1, PSA9: 1 };
const valueFactor = (i: CollectionItem) => CONDITION_FACTOR[i.condition];
const conditionLabel = (c: Condition) => CONDITIONS.find(([v]) => v === c)?.[1] ?? c;

export function Portfolio() {
  const navigate = useNavigate();
  const { items, update, remove, replaceAll } = useCollection();
  const [tab, setTab] = useState<Tab>('cards');
  const [sort, setSort] = useState<Sort>('value');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [prices, setPrices] = useState<Record<string, LivePrice | null>>({});
  const [fx, setFx] = useState<number | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const ids = useMemo(() => [...new Set(items.map((i) => i.cardId))].sort(), [items]);

  // Live valuation: refresh on open, every few minutes, and when the app returns to the foreground.
  useEffect(() => {
    if (!ids.length) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
      const res = await Promise.all(chunks.map((c) => api.prices(c).catch(() => null)));
      if (!alive) return;
      setPrices((p) => Object.assign({}, p, ...res.map((r) => r?.prices ?? {})));
      setFetchedAt(new Date().toISOString());
      setLoading(false);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ids.join(',')]);

  useEffect(() => {
    fetch('/api/fx').then((r) => r.json()).then((f) => setFx(f.jpyToEur)).catch(() => {});
  }, []);

  const unitValue = (i: CollectionItem) => {
    const p = prices[i.cardId]?.trend;
    return p != null ? p * CONDITION_FACTOR[i.condition] : null;
  };
  const costEur = (i: CollectionItem) =>
    i.cost ? (i.cost.currency === 'EUR' ? i.cost.amount : fx ? i.cost.amount * fx : null) : null;

  const totals = useMemo(() => {
    let value = 0;
    let priced = 0;
    let cost = 0;
    let costed = 0;
    let costedValue = 0;
    for (const i of items) {
      const v = unitValue(i);
      if (v != null) {
        value += v * i.qty;
        priced++;
      }
      const c = costEur(i);
      if (c != null && v != null) {
        cost += c * i.qty;
        costedValue += v * i.qty;
        costed++;
      }
    }
    return { value, priced, cost, costed, profit: costedValue - cost, count: items.reduce((n, i) => n + i.qty, 0) };
  }, [items, prices, fx]);

  // Keep one value per day once all cards are priced, for the change figure and chart.
  const complete = items.length > 0 && totals.priced === items.length;
  useEffect(() => {
    if (complete) recordPortfolioValue(totals.value);
  }, [complete, totals.value]);
  const history = useMemo(() => readPortfolioHistory(), [complete, totals.value]);
  const change = useMemo(() => {
    if (history.length < 2) {
      // No recorded week yet: compare with Cardmarket's 7-day averages.
      const avg7 = items.reduce((n, i) => n + (prices[i.cardId]?.avg7 ?? prices[i.cardId]?.trend ?? 0) * CONDITION_FACTOR[i.condition] * i.qty, 0);
      return avg7 > 0 ? { delta: totals.value - avg7, since: '', week: true } : null;
    }
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const base = [...history].reverse().find(([d]) => d <= weekAgo) ?? history[0];
    return { delta: totals.value - base[1], since: base[0], week: base[0] <= weekAgo };
  }, [history.length, totals.value, prices, items]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items
      .filter((i) => (tab === 'sealed' ? isSealed(i) : !isSealed(i)))
      .filter((i) => !s || i.nameJa.includes(s) || i.nameEn?.toLowerCase().includes(s) || i.setId.toLowerCase().includes(s) || i.number.includes(s))
      .sort((a, b) => {
        if (sort === 'recent') return b.addedAt.localeCompare(a.addedAt);
        if (sort === 'name') return (a.nameEn ?? a.nameJa).localeCompare(b.nameEn ?? b.nameJa);
        if (sort === 'profit') return ((unitValue(b) ?? 0) - (costEur(b) ?? unitValue(b) ?? 0)) * b.qty - ((unitValue(a) ?? 0) - (costEur(a) ?? unitValue(a) ?? 0)) * a.qty;
        return (unitValue(b) ?? 0) * b.qty - (unitValue(a) ?? 0) * a.qty;
      });
  }, [items, prices, sort, q, fx, tab]);

  const sets = useMemo(() => {
    const m = new Map<string, { setId: string; setName: string; cards: number; value: number; image: string | null; cardId: string }>();
    for (const i of items) {
      const e = m.get(i.setId) ?? { setId: i.setId, setName: i.setName, cards: 0, value: 0, image: i.image, cardId: i.cardId };
      e.cards += i.qty;
      e.value += (unitValue(i) ?? 0) * i.qty;
      m.set(i.setId, e);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [items, prices]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cardtellicence-sammlung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setMenu(false);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const next = (Array.isArray(data) ? data : data.items) as CollectionItem[];
      if (!Array.isArray(next) || next.some((i) => !i.cardId)) throw new Error('format');
      if (confirm(`${next.length} Einträge importieren? Die aktuelle Sammlung wird ersetzt.`)) replaceAll(next);
    } catch {
      alert('Datei konnte nicht gelesen werden.');
    }
    setMenu(false);
  };

  return (
    <>
      <AppBar />
      <nav className="seg-tabs">
        {(
          [
            ['cards', 'Karten'],
            ['sealed', 'Sealed'],
            ['sets', 'Sets'],
            ['watch', 'Merkliste'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? 'seg on' : 'seg'} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'watch' ? (
        <Watchlist embedded />
      ) : (
        <>
          <div className="search-row">
            <div className="search-box">
              <svg viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5" /></svg>
              <input placeholder="Karten suchen" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button
              className="square-btn"
              aria-label="Sortieren"
              onClick={() => setSort(sort === 'value' ? 'recent' : sort === 'recent' ? 'name' : sort === 'name' ? 'profit' : 'value')}
            >
              <svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" /></svg>
            </button>
          </div>

          <div className="pf-head">
            <div>
              <div className="pf-label">
                Portfolio: <span className="accent">Hauptsammlung</span> · {totals.count} Karten
              </div>
              <div className="pf-value">{items.length ? fmtEur(totals.value) : fmtEur(0)}</div>
              {change && (
                <div className={`pf-change ${change.delta >= 0 ? 'up' : 'down'}`}>
                  {fmtSigned(change.delta)} {!change.since ? 'ggü. 7-Tage-Durchschnitt' : change.week ? 'in den letzten 7 Tagen' : `seit ${new Date(change.since).toLocaleDateString('de-DE')}`}
                </div>
              )}
              {totals.costed > 0 && (
                <div className="pf-sub">
                  Einkauf {fmtEur(totals.cost)} ·{' '}
                  <span className={totals.profit >= 0 ? 'up' : 'down'}>Gewinn {fmtSigned(totals.profit)}</span>
                </div>
              )}
              <div className="pf-sub muted">
                {loading ? 'Preise werden aktualisiert…' : fetchedAt ? `Cardmarket-Preise · aktualisiert ${ago(fetchedAt)}` : ''}
              </div>
            </div>
            <div className="pf-actions">
              <button className="square-btn" onClick={() => setMenu(!menu)} aria-label="Mehr">
                <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /></svg>
              </button>
              <button className={`square-btn ${editing ? 'active' : ''}`} onClick={() => setEditing(!editing)} aria-label="Bearbeiten">
                <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
              </button>
              {menu && (
                <div className="menu">
                  <button onClick={exportJson}>Sammlung exportieren (Backup)</button>
                  <button onClick={() => importInput.current?.click()}>Sammlung importieren</button>
                  <button onClick={() => navigate('/scan')}>Karte scannen</button>
                </div>
              )}
              <input ref={importInput} type="file" accept="application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
            </div>
          </div>

          <PortfolioChart items={items} prices={prices} factor={valueFactor} snapshots={history} />

          {!items.length && (
            <div className="empty-state">
              <p>Deine Sammlung ist noch leer.</p>
              <button className="primary-btn" onClick={() => navigate('/scan')}>
                Erste Karte scannen
              </button>
            </div>
          )}

          {(tab === 'cards' || tab === 'sealed') && (
            <>
              {items.length > 0 && (
                <div className="row-scroll">
                  <Chips<Sort> value={sort} onChange={setSort} options={[['value', 'Wert'], ['recent', 'Neueste'], ['name', 'Name'], ['profit', 'Gewinn']]} />
                </div>
              )}
              <div className="pf-grid">
                {list.map((i) => {
                  const v = unitValue(i);
                  const c = costEur(i);
                  const body = (
                    <>
                      <div className="pf-img">
                        <Thumb id={i.cardId} image={i.image} fallback={i.photo} alt={i.nameJa} />
                      </div>
                      <div className="pf-name">{i.nameEn ?? i.nameJa}</div>
                      <div className="pf-num">{isSealed(i) ? i.number : `#${i.number.split('/')[0]}`}</div>
                      <div className="pf-price">
                        {v != null ? fmtEur(v) : prices[i.cardId] === null ? 'kein Preis' : '…'}
                        {c != null && v != null && <span className={`pf-pl ${marginClass(v - c)}`}>{fmtSigned(v - c)}</span>}
                      </div>
                      <div className="pf-set">{i.setName || i.setId}</div>
                      {i.cost && <div className="pf-cost">Einkauf {i.cost.currency === 'JPY' ? fmtJpy(i.cost.amount) : fmtEur(i.cost.amount)}</div>}
                      <div className="pf-meta">
                        <span>{isSealed(i) ? 'Versiegelt' : conditionLabel(i.condition)}</span>
                        <span>Anz.: {i.qty}</span>
                      </div>
                    </>
                  );
                  return editing ? (
                    <div key={i.uid} className="pf-tile editing">
                      {body}
                      <div className="pf-edit">
                        <button onClick={() => (i.qty > 1 ? update(i.uid, { qty: i.qty - 1 }) : confirm('Karte entfernen?') && remove(i.uid))}>−</button>
                        <button onClick={() => update(i.uid, { qty: i.qty + 1 })}>+</button>
                        <select value={i.condition} onChange={(e) => update(i.uid, { condition: e.target.value as Condition })}>
                          {CONDITIONS.map(([val, label]) => (
                            <option key={val} value={val}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button className="danger" onClick={() => confirm('Karte entfernen?') && remove(i.uid)} aria-label="Entfernen">
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <CardLink
                      key={i.uid}
                      id={i.cardId}
                      className="pf-tile"
                      preview={{
                        card: { id: i.cardId, setId: i.setId, setName: i.setName, localId: i.number.split('/')[0], number: i.number, nameJa: i.nameJa, nameEn: i.nameEn, rarity: i.rarity, image: i.image },
                        cardmarket: prices[i.cardId]?.source === 'cardmarket' ? prices[i.cardId] : null,
                      }}
                    >
                      {body}
                    </CardLink>
                  );
                })}
              </div>
              {tab === 'sealed' && items.length > 0 && !list.length && (
                <p className="empty">Noch keine Sealed-Produkte. Füge Displays oder Booster über Deals → Sealed hinzu.</p>
              )}
              {items.length > 0 && (
                <p className="hint">Wert = Cardmarket-Trend der japanischen Ausgabe; gespielte Zustände geschätzt (LP −15 %, MP −30 %, HP −50 %). PSA-Karten zum Rohpreis.</p>
              )}
            </>
          )}

          {tab === 'sets' && (
            <ul className="list">
              {sets.map((s) => (
                <li key={s.setId}>
                  <button className="deal set-row" onClick={() => (setQ(s.setId), setTab('cards'))}>
                    <Thumb id={s.cardId} image={s.image} alt={s.setName} />
                    <div className="deal-main">
                      <div className="deal-name">{s.setName || s.setId}</div>
                      <div className="deal-meta">
                        {s.setId} · {s.cards} Karten
                      </div>
                    </div>
                    <div className="deal-margin pos">
                      <strong>{fmtEur(s.value)}</strong>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
