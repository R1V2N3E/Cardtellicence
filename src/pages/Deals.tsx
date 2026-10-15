import { useEffect, useMemo, useRef, useState } from 'react';
import { api, loadOpportunities, useAsync } from '../api';
import { CardLink, Chips, ErrorBox, Header, Spinner, Thumb } from '../components/ui';
import { ago, fmtEur, fmtJpy, fmtPct, fmtSigned, marginClass, yuyuteiImg } from '../format';
import { BUY_LABEL, opportunityMargin, SELL_LABEL } from '../margin';
import { useSettings } from '../state';
import { usePullToRefresh, useSwipeTabs } from '../gestures';
import { SealedSheet, sealedLabel, sealedMargin } from '../components/SealedSheet';
import type { SealedItem } from '../../lib/types';

type Sort = 'margin' | 'roi' | 'value';

/** "116/80", "116/080" or "116" against a printed number like "116/080". */
function numberMatches(number: string, q: string): boolean {
  const m = q.match(/^#?(\d{1,3})(?:\s*\/\s*(\d{1,3}))?$/);
  if (!m) return false;
  const [n, total] = number.split('/').map(Number);
  return n === Number(m[1]) && (!m[2] || total === Number(m[2]));
}

export function Deals() {
  const [settings] = useSettings();
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading } = useAsync(() => loadOpportunities(refresh > 0), [refresh]);
  // Live ECB rate, so margins follow the current exchange rate rather than the scan's.
  const { data: liveFx, loading: fxLoading } = useAsync(() => api.fx(refresh > 0), [refresh]);
  const fx = liveFx ?? data?.fx;
  const busy = loading || fxLoading;
  const [toast, setToast] = useState<string | null>(null);
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (!refresh || busy || lastRefresh.current === refresh) return;
    lastRefresh.current = refresh;
    setToast(error ? `Aktualisierung fehlgeschlagen: ${error}` : `Aktualisiert ✓ · Preise vom Scan ${ago(data?.generatedAt)} · Kurs EZB ${fx?.date ?? ''}`);
  }, [refresh, busy]);
  // The toast closes itself; its own effect so later re-renders can't cancel the timer.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const [sort, setSort] = useState<Sort>('margin');
  const [setFilter, setSetFilter] = useState('all');
  const [text, setText] = useState('');
  const [onlyPositive, setOnlyPositive] = useState(true);
  const [kind, setKind] = useState<'cards' | 'sealed'>('cards');
  const [openSealed, setOpenSealed] = useState<SealedItem | null>(null);
  const { pull, ready } = usePullToRefresh(() => setRefresh((r) => r + 1), !openSealed);
  useSwipeTabs(['cards', 'sealed'], kind, setKind, !openSealed);
  const resetFilters = () => {
    setOnlyPositive(false);
    setSetFilter('all');
    setText('');
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const q = text.trim().toLowerCase();
    return data.items
      .filter((o) => (o.cmTrend ?? 0) >= settings.minTrend)
      .filter((o) => setFilter === 'all' || o.setId === setFilter)
      .filter((o) => !q || o.nameJa.includes(q) || o.nameEn?.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || numberMatches(o.number, q))
      .map((o) => ({ o, m: opportunityMargin(o, settings, (fx ?? data.fx).jpyToEur) }))
      .filter(({ m }) => m.buy && (!onlyPositive || (m.marginEur ?? 0) > 0))
      .sort((a, b) =>
        sort === 'roi' ? (b.m.roi ?? -9) - (a.m.roi ?? -9) : sort === 'value' ? (b.m.sellEur ?? 0) - (a.m.sellEur ?? 0) : (b.m.marginEur ?? -1e9) - (a.m.marginEur ?? -1e9),
      )
      .slice(0, 200);
  }, [data, fx, settings, sort, setFilter, text, onlyPositive]);

  const sealedRows = useMemo(() => {
    if (!data?.sealed) return [];
    const q = text.trim().toLowerCase();
    const rate = fx ?? data.fx;
    return data.sealed
      .filter((x) => setFilter === 'all' || x.setId === setFilter)
      .filter((x) => !q || x.nameEn.toLowerCase().includes(q) || x.setName.includes(q) || x.setId.toLowerCase().includes(q))
      .map((x) => ({ x, m: sealedMargin(x, settings, rate) }))
      .filter(({ m }) => !onlyPositive || (m.marginEur ?? 0) > 0)
      .sort((a, b) =>
        sort === 'roi' ? (b.m.roi ?? -9) - (a.m.roi ?? -9) : sort === 'value' ? (b.m.sellEur ?? 0) - (a.m.sellEur ?? 0) : (b.m.marginEur ?? -1e9) - (a.m.marginEur ?? -1e9),
      );
  }, [data, fx, settings, sort, setFilter, text, onlyPositive]);

  return (
    <>
      <div className="pull" style={{ height: pull }} aria-hidden={!pull}>
        {pull > 10 && (
          <span className={ready ? 'ready' : ''}>
            <svg viewBox="0 0 24 24" style={{ transform: `rotate(${pull * 3}deg)` }}>
              <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
            </svg>
            {ready ? 'Loslassen zum Aktualisieren' : 'Ziehen zum Aktualisieren'}
          </span>
        )}
      </div>
      <Header
        title="Deals"
        sub={
          data
            ? `Kauf ${settings.buySource === 'mercari' ? 'Günstigster (Mercari nicht im Scan)' : BUY_LABEL[settings.buySource]} → Verkauf ${SELL_LABEL[settings.sellRef]} · Scan ${ago(data.generatedAt)}`
            : 'Margen Japan → Deutschland'
        }
        right={
          <button className={`icon-btn ${busy ? 'spinning' : ''}`} disabled={busy} onClick={() => setRefresh((r) => r + 1)} aria-label="Neu laden">
            <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
          </button>
        }
      />
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      <div className="seg-tabs deals-seg">
        <button className={kind === 'cards' ? 'seg on' : 'seg'} onClick={() => setKind('cards')}>
          Karten
        </button>
        <button className={kind === 'sealed' ? 'seg on' : 'seg'} onClick={() => setKind('sealed')}>
          Sealed {data?.sealed?.length ? `(${data.sealed.length})` : ''}
        </button>
      </div>
      <div className="toolbar">
        <input className="input" placeholder="Name, Set oder Nummer (116/80)…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row-scroll">
          <Chips<Sort> value={sort} onChange={setSort} options={[['margin', 'Marge €'], ['roi', 'ROI %'], ['value', 'Wert']]} />
          <select className="select" value={setFilter} onChange={(e) => setSetFilter(e.target.value)} aria-label="Set">
            <option value="all">Alle Sets</option>
            {data?.sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.name}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={onlyPositive} onChange={(e) => setOnlyPositive(e.target.checked)} />
            Nur profitable
          </label>
        </div>
      </div>

      {loading && !data && <Spinner label="Tages-Scan wird geladen…" />}
      {error && <ErrorBox message={`Scan konnte nicht geladen werden: ${error}`} />}
      {data && (
        <p className="hint">
          1 € = {fmtJpy(1 / (fx ?? data.fx).jpyToEur)} (EZB {(fx ?? data.fx).date}) · {kind === 'sealed' ? `${sealedRows.length} Produkte` : `${rows.length} Karten · min. Cardmarket ${fmtEur(settings.minTrend)}`}
        </p>
      )}

      {kind === 'sealed' && (
        <>
          {data && !data.sealed?.length && <p className="empty">Sealed-Daten kommen mit dem nächsten täglichen Scan.</p>}
          {data && !!data.sealed?.length && sealedRows.length < data.sealed.length && (
            <div className="filter-note">
              {sealedRows.length} von {data.sealed.length} angezeigt{onlyPositive ? ' (nur profitable)' : ''}.
              <button className="chip" onClick={resetFilters}>
                Alle zeigen
              </button>
            </div>
          )}
          <ul className="list">
            {sealedRows.map(({ x, m }) => (
              <li key={x.id}>
                <button className="deal sealed-row" onClick={() => setOpenSealed(x)}>
                  {x.image ? <img className="thumb sealed-thumb" src={x.image} alt="" loading="lazy" /> : <div className="thumb ph">📦</div>}
                  <div className="deal-main">
                    <div className="deal-name">{x.nameEn}</div>
                    <div className="deal-meta">
                      {x.setId} · {sealedLabel(x)}
                    </div>
                    <div className="deal-prices">
                      <span className="jp">
                        🇯🇵 {fmtJpy(m.buy?.jpy)} <small>{m.buy?.label ?? '–'}{m.buy?.note ? ` (${m.buy.note})` : ''}</small>
                      </span>
                      <span className="de">🇩🇪 {fmtEur(m.sellEur)}</span>
                    </div>
                  </div>
                  <div className={`deal-margin ${marginClass(m.marginEur)}`}>
                    <strong>{fmtSigned(m.marginEur)}</strong>
                    <small>{fmtPct(m.roi)}</small>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {openSealed && data && <SealedSheet item={openSealed} fx={fx ?? data.fx} settings={settings} onClose={() => setOpenSealed(null)} />}

      {kind === 'cards' && (
      <ul className="list">
        {rows.map(({ o, m }, idx) => (
          <li key={o.id}>
            <CardLink
              id={o.id}
              className="deal"
              preview={{
                card: { id: o.id, setId: o.setId, setName: o.setName, localId: o.number.split('/')[0], number: o.number, nameJa: o.nameJa, nameEn: o.nameEn, rarity: o.rarity, image: o.image },
                image: yuyuteiImg(o.yytUrl) ?? o.snkImg,
                cardmarket: { trend: o.cmTrend, avg30: o.cmAvg30, low: o.cmLow },
                fx: fx ?? data?.fx,
              }}
            >
              <Thumb eager={idx < 6} id={o.id} image={o.image} fallback={yuyuteiImg(o.yytUrl) ?? o.snkImg} alt={o.nameJa} />
              <div className="deal-main">
                <div className="deal-name">{o.nameEn ?? o.nameJa}</div>
                <div className="deal-meta">
                  {o.nameEn && <span>{o.nameJa} · </span>}
                  {o.setId} {o.number} {o.rarity && `· ${o.rarity}`}
                </div>
                <div className="deal-prices">
                  <span className="jp">
                    🇯🇵 {fmtJpy(m.buy!.jpy)} <small>{m.buy!.label}{m.buy!.note ? ` (${m.buy!.note})` : ''}</small>
                  </span>
                  <span className="de">🇩🇪 {fmtEur(m.sellEur)}</span>
                </div>
              </div>
              <div className={`deal-margin ${marginClass(m.marginEur)}`}>
                <strong>{fmtSigned(m.marginEur)}</strong>
                <small>{fmtPct(m.roi)}</small>
              </div>
            </CardLink>
          </li>
        ))}
      </ul>
      )}
      {kind === 'cards' && data && !rows.length && (
        <div className="empty">
          <p>Keine Treffer mit diesen Filtern.</p>
          <button className="link-btn" onClick={resetFilters}>
            Filter zurücksetzen
          </button>
        </div>
      )}
    </>
  );
}
