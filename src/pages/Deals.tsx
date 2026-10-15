import { useEffect, useMemo, useRef, useState } from 'react';
import { api, loadOpportunities, useAsync } from '../api';
import { CardLink, Chips, ErrorBox, Header, Spinner, Thumb } from '../components/ui';
import { ago, fmtEur, fmtJpy, fmtPct, fmtSigned, marginClass, yuyuteiImg } from '../format';
import { BUY_LABEL, opportunityMargin, reverseMargin, SELL_LABEL } from '../margin';
import { useSettings } from '../state';
import { usePullToRefresh, useSwipeTabs } from '../gestures';
import { SealedSheet, sealedLabel, sealedMargin } from '../components/SealedSheet';
import type { Opportunity, SealedItem } from '../../lib/types';

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
  const { data: scanData, error, loading } = useAsync(() => loadOpportunities(refresh > 0), [refresh]);
  // Live prices fetched in the app on refresh, laid over the daily scan.
  const [live, setLive] = useState<{ items: Record<string, Partial<Opportunity>>; sealed: Record<string, Partial<SealedItem>>; at: string | null; done: number; total: number }>({
    items: {},
    sealed: {},
    at: null,
    done: 0,
    total: 0,
  });
  const data = useMemo(() => {
    if (!scanData || !live.at) return scanData;
    return {
      ...scanData,
      items: scanData.items.map((o) => (live.items[o.id] ? { ...o, ...live.items[o.id] } : o)),
      sealed: scanData.sealed?.map((x) => (live.sealed[x.id] ? { ...x, ...live.sealed[x.id] } : x)),
    };
  }, [scanData, live]);
  // Live ECB rate, so margins follow the current exchange rate rather than the scan's.
  const { data: liveFx, loading: fxLoading } = useAsync(() => api.fx(refresh > 0), [refresh]);
  const fx = liveFx ?? data?.fx;
  const busy = loading || fxLoading;
  const [toast, setToast] = useState<string | null>(null);
  const lastRefresh = useRef(0);
  // Refresh: re-read Card Rush and Cardmarket for every set, a few sets per request. Runs on its
  // own (not tied to the scan file reloading at the same time) and stops only when leaving the page.
  const [liveBusy, setLiveBusy] = useState(false);
  const scanRef = useRef(scanData);
  scanRef.current = scanData;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  useEffect(() => {
    if (!refresh || lastRefresh.current === refresh) return;
    lastRefresh.current = refresh;
    void (async () => {
      // On the very first load the set list comes with the scan file.
      const scan = scanRef.current ?? (await loadOpportunities().catch(() => null));
      if (!scan) return;
      const sets = scan.sets.map((s) => s.id);
      const queue: string[][] = [];
      for (let i = 0; i < sets.length; i += 6) queue.push(sets.slice(i, i + 6));
      let failed = 0;
      setLiveBusy(true);
      setLive((l) => ({ ...l, done: 0, total: sets.length }));
      const worker = async () => {
        for (let c = queue.shift(); c && mounted.current; c = queue.shift()) {
          const patch = await api.live(c, true).catch(() => null);
          if (!patch) failed += c.length;
          if (mounted.current)
            setLive((l) => ({
              items: { ...l.items, ...patch?.items },
              sealed: { ...l.sealed, ...patch?.sealed },
              at: patch?.at ?? l.at,
              done: l.done + c.length,
              total: l.total,
            }));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (!mounted.current) return;
      setLiveBusy(false);
      setToast(
        failed === sets.length
          ? 'Live-Aktualisierung fehlgeschlagen – es gelten die Preise vom Scan.'
          : failed
            ? `Teilweise aktualisiert: ${sets.length - failed} von ${sets.length} Sets live`
            : `Live-Preise ✓ Card Rush & Cardmarket für ${sets.length} Sets`,
      );
    })();
  }, [refresh]);
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
  const [kind, setKind] = useState<'cards' | 'sealed' | 'reverse'>('cards');
  const [openSealed, setOpenSealed] = useState<SealedItem | null>(null);
  const { pull, ready } = usePullToRefresh(() => setRefresh((r) => r + 1), !openSealed);
  useSwipeTabs(['cards', 'sealed', 'reverse'], kind, setKind, !openSealed);
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

  // Germany → Japan: buy on Cardmarket, sell to Card Rush's buyback.
  const reverseRows = useMemo(() => {
    if (!data) return [];
    const q = text.trim().toLowerCase();
    const rate = (fx ?? data.fx).jpyToEur;
    return data.items
      .filter((o) => setFilter === 'all' || o.setId === setFilter)
      .filter((o) => !q || o.nameJa.includes(q) || o.nameEn?.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || numberMatches(o.number, q))
      .map((o) => ({ o, r: reverseMargin(o, settings, rate) }))
      .filter((x): x is { o: typeof x.o; r: NonNullable<typeof x.r> } => !!x.r && (!onlyPositive || x.r.marginEur > 0))
      .sort((a, b) => (sort === 'roi' ? b.r.roi - a.r.roi : sort === 'value' ? b.r.payoutEur - a.r.payoutEur : b.r.marginEur - a.r.marginEur))
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
            ? `Kauf ${settings.buySource === 'mercari' ? 'Günstigster (Mercari nicht im Scan)' : BUY_LABEL[settings.buySource]} → Verkauf ${SELL_LABEL[settings.sellRef]}${settings.net ? ' · netto' : ''} · ${liveBusy ? `Live ${live.done}/${live.total} Sets…` : live.at ? `Live ${ago(live.at)}` : `Scan ${ago(data.generatedAt)}`}${!live.at && Date.now() - Date.parse(data.generatedAt) > 30 * 3600_000 ? ' ⚠︎ veraltet' : ''}`
            : 'Margen Japan → Deutschland'
        }
        right={
          <button className={`icon-btn ${busy || liveBusy ? 'spinning' : ''}`} disabled={busy || liveBusy} onClick={() => setRefresh((r) => r + 1)} aria-label="Neu laden">
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
        <button className={kind === 'reverse' ? 'seg on' : 'seg'} onClick={() => setKind('reverse')}>
          DE → JP
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
          1 € = {fmtJpy(1 / (fx ?? data.fx).jpyToEur)} (EZB {(fx ?? data.fx).date}) · {kind === 'sealed'
            ? `${sealedRows.length} Produkte`
            : kind === 'reverse'
              ? `${reverseRows.length} Karten`
              : `${rows.length} Karten · min. Cardmarket ${fmtEur(settings.minTrend)}`}
        </p>
      )}

      {kind === 'reverse' && (
        <>
          <p className="filter-note reverse-note">
            In Deutschland auf Cardmarket kaufen ({SELL_LABEL[settings.revBuyRef ?? 'trend']}) und an Card Rush verkaufen (Ankaufspreis 買取). Card Rush kauft per Post
            nur mit japanischer Adresse und Ausweis an und zahlt den vollen Preis nur für einwandfreie Karten – praktisch also für Reisen nach Japan
            oder mit Partner vor Ort.
          </p>
          <ul className="list">
            {reverseRows.map(({ o, r }) => (
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
                  <Thumb id={o.id} image={o.image} fallback={yuyuteiImg(o.yytUrl) ?? o.snkImg} alt={o.nameJa} />
                  <div className="deal-main">
                    <div className="deal-name">{o.nameEn ?? o.nameJa}</div>
                    <div className="deal-meta">
                      {o.setId} {o.number} {o.rarity && `· ${o.rarity}`}
                    </div>
                    <div className="deal-prices">
                      <span className="jp">
                        🇩🇪 {fmtEur(r.buyEur)} <small>Cardmarket{r.costEur - r.buyEur > 0.005 ? ` + ${fmtEur(r.costEur - r.buyEur)} Kosten` : ''}</small>
                      </span>
                      <span className="de">
                        🇯🇵 {fmtJpy(o.crBuyJpy)} <small>Card Rush Ankauf ≈ {fmtEur(r.payoutEur)}</small>
                      </span>
                    </div>
                  </div>
                  <div className={`deal-margin ${marginClass(r.marginEur)}`}>
                    <strong>{fmtSigned(r.marginEur)}</strong>
                    <small>{fmtPct(r.roi)}</small>
                  </div>
                </CardLink>
              </li>
            ))}
          </ul>
          {data && !reverseRows.length && (
            <div className="empty">
              <p>Gerade keine Karte, die Card Rush teurer ankauft, als sie auf Cardmarket kostet.</p>
              <button className="link-btn" onClick={resetFilters}>
                Filter zurücksetzen
              </button>
            </div>
          )}
        </>
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
