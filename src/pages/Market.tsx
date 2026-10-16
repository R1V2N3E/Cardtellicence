import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, loadOpportunities, useAsync } from '../api';
import { Change, ShareBar, Spark } from '../components/MarketBits';
import { CardLink, Chips, ErrorBox, Header, Spinner, Thumb } from '../components/ui';
import { ago, fmtEur, yuyuteiImg } from '../format';
import { buildMarket, ERAS, indexSeries, jpPremium, laggards, MOM_LABEL, movers, pct, seriesChange, type CardStat, type Era } from '../market';
import { useCollection } from '../state';

type SetSort = 'value' | 'change30' | 'daily' | 'jp';
type Chance = 'lag' | 'up' | 'down' | 'jp';

export const GearLink = () => (
  <Link to="/settings" className="icon-btn" aria-label="Einstellungen">
    <svg viewBox="0 0 24 24">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />
    </svg>
  </Link>
);

/** One card row in the analysis lists: picture, name, why it is listed, value and change. */
export function StatRow({ c, why }: { c: CardStat; why: string }) {
  const o = c.o;
  return (
    <li>
      <CardLink
        id={o.id}
        className="deal"
        preview={{
          card: { id: o.id, setId: o.setId, setName: o.setName, localId: o.number.split('/')[0], number: o.number, nameJa: o.nameJa, nameEn: o.nameEn, rarity: o.rarity, image: o.image },
          image: yuyuteiImg(o.yytUrl) ?? o.snkImg,
          cardmarket: { trend: o.cmTrend, avg30: o.cmAvg30, low: o.cmLow },
        }}
      >
        <Thumb id={o.id} image={o.image} fallback={yuyuteiImg(o.yytUrl) ?? o.snkImg} alt={o.nameJa} />
        <div className="deal-main">
          <div className="deal-name">{o.nameEn ?? o.nameJa}</div>
          <div className="deal-meta">
            {o.setId} {o.number} {o.rarity && `· ${o.rarity}`}
          </div>
          <div className="why">{why}</div>
        </div>
        <div className="stat-right">
          <strong>{fmtEur(c.value)}</strong>
          <Change v={c.mom30} label={MOM_LABEL} />
        </div>
      </CardLink>
    </li>
  );
}

export function Market() {
  const { data, error, loading } = useAsync(() => loadOpportunities(), []);
  const { data: market } = useAsync(() => api.market(), []);
  const { items } = useCollection();
  const [era, setEra] = useState<Era | 'all'>('all');
  const [sort, setSort] = useState<SetSort>('value');
  const [chance, setChance] = useState<Chance>('lag');
  const [explain, setExplain] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const view = useMemo(() => (data ? buildMarket(data.items, data.sets, data.fx.jpyToEur) : null), [data]);
  const owned = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (!i.cardId.startsWith('cm-')) m.set(i.setId, (m.get(i.setId) ?? 0) + i.qty);
    return m;
  }, [items]);

  // Change of each set's daily index since the first scan day (grows more meaningful every day).
  const daily = useMemo(() => new Map(view?.sets.map((s) => [s.key, seriesChange(indexSeries(market ?? null, [s.key]))]) ?? []), [view, market]);
  const days = market ? Object.keys(market.days).length : 0;
  const since = market ? Object.keys(market.days).sort()[0] : null;
  const sinceLabel = since ? `seit ${new Date(since).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}` : '';
  const sets = useMemo(() => {
    if (!view) return [];
    const list = view.sets.filter((s) => era === 'all' || s.era === era);
    const key = (s: (typeof list)[number]) =>
      sort === 'value' ? s.value : sort === 'change30' ? (s.change30 ?? -9) : sort === 'daily' ? (daily.get(s.key) ?? -9) : s.value ? s.jpValue / s.value : 0;
    return [...list].sort((a, b) => key(b) - key(a));
  }, [view, era, sort, daily]);
  const rankOf = useMemo(() => new Map(view?.sets.slice().sort((a, b) => b.value - a.value).map((s, i) => [s.key, i + 1]) ?? []), [view]);

  const chances = useMemo(() => {
    if (!view) return [];
    if (chance === 'lag')
      return laggards(view).map(({ c, set }) => ({ c, why: `Set ${pct(set.change30, 0)}, Karte ${pct(c.mom30, 0)} (7T/30T) – hinkt hinterher` }));
    if (chance === 'jp')
      return jpPremium(view).map((c) => ({ c, why: `Japan ${fmtEur(c.jpEur)} vs. Cardmarket ${fmtEur(c.value)} (×${c.jpPremium!.toFixed(1).replace('.', ',')})` }));
    return movers(view, chance === 'up' ? 1 : -1).map((c) => ({ c, why: `Ø 30 Tage ${fmtEur(c.o.cmAvg30)} → Ø 7 Tage ${fmtEur(c.o.cmAvg7)}` }));
  }, [view, chance]);

  const totalSeries = useMemo(() => indexSeries(market ?? null, null), [market]);

  if (error) return (<><Header title="Markt" right={<GearLink />} /><ErrorBox message={error} /></>);
  if (loading || !view || !data) return (<><Header title="Markt" right={<GearLink />} /><Spinner label="Markt wird berechnet…" /></>);

  const eraSeries = (e: Era) => indexSeries(market ?? null, view.sets.filter((s) => s.era === e).map((s) => s.key));
  const maxSet = Math.max(...sets.map((s) => s.value), 1);

  return (
    <>
      <Header title="Markt" sub={`${view.cards.length.toLocaleString('de-DE')} Karten · ${view.sets.length} Sets · Stand ${ago(data.generatedAt)}`} right={<GearLink />} />

      <section className="panel market-hero">
        <div className="mh-top">
          <div>
            <div className="pf-label">Gesamtwert aller erfassten Karten</div>
            <div className="pf-value">{fmtEur(view.total.value)}</div>
            <div className="mh-chips">
              <Change v={view.total.change30} label={MOM_LABEL} />
              {seriesChange(totalSeries) != null && <Change v={seriesChange(totalSeries)} label={sinceLabel} />}
            </div>
          </div>
          <Spark points={totalSeries} width={110} height={44} />
        </div>
        <button className="link-btn explain-btn" onClick={() => setExplain(!explain)}>
          {explain ? 'Erklärung schließen' : 'Wie wird gerechnet?'}
        </button>
        {explain && (
          <div className="explain">
            <p>
              <b>Wert</b> = Summe der Cardmarket-Trendpreise aller Karten, die der tägliche Scan erfasst (japanische Ausgaben ab ca. 3 €).
            </p>
            <p>
              <b>7T/30T (Momentum)</b> = Durchschnittspreis der letzten 7 Tage gegenüber dem der letzten 30 Tage – beides echte Verkäufe. Für Sets und
              Generationen der nach Wert gewichtete Median: teure Karten zählen mehr, einzelne Ausreißer mit wenigen Verkäufen kippen das Ergebnis nicht.
              (Bewusst nicht „Trend vs. 30-Tage-Ø“: der Trend ist ein Near-Mint-Preis, im Durchschnitt stecken auch bespielte Karten – das würde bei
              alten Sets einen falschen Anstieg zeigen.) Karten, deren Durchschnitte stark vom Trend abweichen (unter 60 % oder über 160 %), zählen
              nicht mit – dort mischen wenige Verkäufe verschiedene Zustände. Sets mit weniger als 5 verwertbaren Karten zeigen kein Momentum. Bei alten,
              dünn gehandelten Sets (Sonne & Mond) bleibt das Momentum trotzdem schwankender; die tägliche Linie wird mit jedem Scan-Tag verlässlicher.
            </p>
            <p>
              <b>seit …</b> = Veränderung des täglichen Werts seit dem ersten Scan-Tag ({days} {days === 1 ? 'Tag' : 'Tage'} bisher) – wird jeden Tag
              aussagekräftiger. Neu erfasste Sets oder Karten zählen dabei nicht als Anstieg.
            </p>
            <p>
              <b>Hinkt hinterher</b> = das Momentum des Sets liegt bei mindestens +5 %, das der Karte mindestens 10 Punkte darunter (aber nicht abgestürzt).
              Solche Karten ziehen oft nach – keine Garantie.
            </p>
            <p>
              <b>JP-Prämie</b> = Card Rush verlangt in Japan deutlich mehr (≥ 1,4×) als Cardmarket. Europa kann nachziehen – oder Japan bewertet anders.
            </p>
          </div>
        )}
      </section>

      <h2 className="section-h">Generationen</h2>
      <ul className="list">
        {view.eras.map((e) => (
          <li key={e.key}>
            <button className={`deal era-row ${era === e.key ? 'selected' : ''}`} onClick={() => setEra(era === e.key ? 'all' : (e.key as Era))}>
              <div className="deal-main">
                <div className="deal-name">{e.name}</div>
                <div className="deal-meta">
                  {view.sets.filter((s) => s.era === e.key).length} Sets · {e.cards} Karten · {Math.round((e.value / view.total.value) * 100)} % des Markts
                </div>
                <ShareBar share={e.value / view.total.value} />
              </div>
              <Spark points={eraSeries(e.key as Era)} />
              <div className="stat-right">
                <strong>{fmtEur(e.value)}</strong>
                <Change v={e.change30} label={MOM_LABEL} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="section-head">
        <h2 className="section-h">Sets-Ranking</h2>
      </div>
      <div className="row-scroll">
        <Chips<Era | 'all'> value={era} onChange={setEra} options={[['all', 'Alle'], ...ERAS.map((e) => [e.key, e.short] as [Era, string])]} />
      </div>
      <div className="row-scroll ranking-sort">
        <Chips<SetSort>
          value={sort}
          onChange={setSort}
          options={[
            ['value', 'Wert'],
            ['change30', 'Momentum'],
            ['daily', 'Täglich'],
            ['jp', 'JP-Prämie'],
          ]}
        />
      </div>
      <ul className="list">
        {(showAll ? sets : sets.slice(0, 15)).map((s) => (
          <li key={s.key}>
            <Link to={`/market/set/${encodeURIComponent(s.key)}`} className="deal set-rank">
              <span className="rank">{rankOf.get(s.key)}</span>
              <Thumb id={s.top?.o.id ?? s.key} image={null} fallback={`/api/img?set=${encodeURIComponent(s.key)}`} alt={s.name} className="thumb pack-thumb" timeout={25000} />
              <div className="deal-main">
                <div className="deal-name">{s.name}</div>
                <div className="deal-meta">
                  {s.key} · {s.cards} Karten{owned.get(s.key) ? ` · Du: ${owned.get(s.key)}` : ''}
                </div>
                <ShareBar share={s.value / maxSet} />
              </div>
              <div className="stat-right">
                <strong>{fmtEur(s.value)}</strong>
                {sort === 'jp' ? (
                  <span className="chg flat">JP ×{(s.jpValue / s.value || 0).toFixed(2).replace('.', ',')}</span>
                ) : sort === 'daily' ? (
                  <Change v={daily.get(s.key)} label={sinceLabel} />
                ) : (
                  <Change v={s.change30} label={MOM_LABEL} />
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {sets.length > 15 && (
        <button className="link-btn more-btn" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Weniger zeigen' : `Alle ${sets.length} Sets zeigen`}
        </button>
      )}

      <h2 className="section-h">Chancen</h2>
      <div className="seg-tabs">
        {(
          [
            ['lag', 'Hinkt hinterher'],
            ['jp', 'JP-Prämie'],
            ['up', 'Gewinner'],
            ['down', 'Verlierer'],
          ] as [Chance, string][]
        ).map(([k, l]) => (
          <button key={k} className={chance === k ? 'seg on' : 'seg'} onClick={() => setChance(k)}>
            {l}
          </button>
        ))}
      </div>
      <p className="hint">
        {chance === 'lag'
          ? 'Karten aus steigenden Sets, die (noch) nicht mitgezogen haben.'
          : chance === 'jp'
            ? 'In Japan deutlich teurer als auf Cardmarket – mögliche Nachzügler in Europa.'
            : chance === 'up'
              ? 'Stärkster Anstieg gegenüber dem 30-Tage-Durchschnitt.'
              : 'Stärkster Rückgang gegenüber dem 30-Tage-Durchschnitt.'}{' '}
        Nur Karten ab 5 €.
      </p>
      <ul className="list">
        {chances.slice(0, 25).map(({ c, why }) => (
          <StatRow key={c.o.id} c={c} why={why} />
        ))}
      </ul>
      {!chances.length && (
        <p className="empty">
          {chance !== 'jp' && view.cards.every((c) => c.mom30 == null)
            ? 'Die Momentum-Werte (Ø 7 Tage) kommen mit dem nächsten täglichen Scan.'
            : 'Gerade keine Karten in dieser Liste.'}
        </p>
      )}
      <p className="hint">Generationen nach Set-Code: {ERAS.map((e) => `${e.short} = ${e.label}`).join(' · ')}. Keine Anlageberatung – Preise können fallen.</p>
    </>
  );
}
