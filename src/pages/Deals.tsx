import { useMemo, useState } from 'react';
import { loadOpportunities, useAsync } from '../api';
import { CardLink, Chips, ErrorBox, Header, Spinner, Thumb } from '../components/ui';
import { ago, fmtEur, fmtJpy, fmtPct, fmtSigned, marginClass, yuyuteiImg } from '../format';
import { BUY_LABEL, opportunityMargin, SELL_LABEL } from '../margin';
import { useSettings } from '../state';

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
  const [sort, setSort] = useState<Sort>('margin');
  const [setFilter, setSetFilter] = useState('all');
  const [text, setText] = useState('');
  const [onlyPositive, setOnlyPositive] = useState(true);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = text.trim().toLowerCase();
    return data.items
      .filter((o) => (o.cmTrend ?? 0) >= settings.minTrend)
      .filter((o) => setFilter === 'all' || o.setId === setFilter)
      .filter((o) => !q || o.nameJa.includes(q) || o.nameEn?.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || numberMatches(o.number, q))
      .map((o) => ({ o, m: opportunityMargin(o, settings, data.fx.jpyToEur) }))
      .filter(({ m }) => m.buy && (!onlyPositive || (m.marginEur ?? 0) > 0))
      .sort((a, b) =>
        sort === 'roi' ? (b.m.roi ?? -9) - (a.m.roi ?? -9) : sort === 'value' ? (b.m.sellEur ?? 0) - (a.m.sellEur ?? 0) : (b.m.marginEur ?? -1e9) - (a.m.marginEur ?? -1e9),
      )
      .slice(0, 200);
  }, [data, settings, sort, setFilter, text, onlyPositive]);

  return (
    <>
      <Header
        title="Deals"
        sub={
          data
            ? `Buy ${BUY_LABEL[settings.buySource]} → sell Cardmarket ${SELL_LABEL[settings.sellRef]} · scanned ${ago(data.generatedAt)}`
            : 'Japan → Germany margins'
        }
        right={
          <button className="icon-btn" onClick={() => setRefresh((r) => r + 1)} aria-label="Reload">
            <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
          </button>
        }
      />
      <div className="toolbar">
        <input className="input" placeholder="Filter by name, set or number (116/80)…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row-scroll">
          <Chips<Sort> value={sort} onChange={setSort} options={[['margin', 'Margin €'], ['roi', 'ROI %'], ['value', 'Value']]} />
          <select className="select" value={setFilter} onChange={(e) => setSetFilter(e.target.value)} aria-label="Set">
            <option value="all">All sets</option>
            {data?.sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.name}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={onlyPositive} onChange={(e) => setOnlyPositive(e.target.checked)} />
            Profitable only
          </label>
        </div>
      </div>

      {loading && !data && <Spinner label="Loading daily scan…" />}
      {error && <ErrorBox message={`Could not load scan: ${error}`} />}
      {data && (
        <p className="hint">
          1 € = {fmtJpy(1 / data.fx.jpyToEur)} (ECB {data.fx.date}) · {rows.length} cards · min. Cardmarket {fmtEur(settings.minTrend)}
        </p>
      )}

      <ul className="list">
        {rows.map(({ o, m }) => (
          <li key={o.id}>
            <CardLink id={o.id} className="deal">
              <Thumb id={o.id} image={o.image} fallback={yuyuteiImg(o.yytUrl) ?? o.snkImg} alt={o.nameJa} />
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
      {data && !rows.length && <p className="empty">No cards match. Lower the minimum price in Settings or include sold-out stock.</p>}
    </>
  );
}
