import { AskAi } from '../components/AskAi';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, loadOpportunities, useAsync } from '../api';
import { Change, ShareBar } from '../components/MarketBits';
import { PriceChart, type Series } from '../components/PriceChart';
import { Chips, ErrorBox, Header, Spinner, Thumb } from '../components/ui';
import { fmtEur } from '../format';
import { buildMarket, ERAS, indexSeries, laggards, MOM_LABEL, pct, seriesChange, type CardStat } from '../market';
import { useCollection } from '../state';
import { GearLink, StatRow } from './Market';

type CardSort = 'value' | 'mom30' | 'jp';
const DAY = 86400_000;

export function MarketSet() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { data, error } = useAsync(() => loadOpportunities(), []);
  const { data: market } = useAsync(() => api.market(), []);
  const { items } = useCollection();
  const [sort, setSort] = useState<CardSort>('value');
  const [all, setAll] = useState(false);

  const view = useMemo(() => (data ? buildMarket(data.items, data.sets, data.fx.jpyToEur) : null), [data]);
  const set = view?.sets.find((s) => s.key === id) ?? null;
  const cards = useMemo(() => view?.bySet.get(id) ?? [], [view, id]);
  const rank = view ? [...view.sets].sort((a, b) => b.value - a.value).findIndex((s) => s.key === id) + 1 : 0;

  const series = useMemo((): Series[] => {
    const daily = indexSeries(market ?? null, [id]);
    if (daily.length >= 3) return [{ label: 'Set-Wert (Trendpreise, täglich)', color: '#8b7cff', points: daily }];
    // Until the daily index has a few days: the average sale prices of the last 30 and 7 days
    // (same kind of number, so the line shows a real move).
    const now = Date.now();
    const both = cards.filter((c) => c.o.cmAvg30 && c.o.cmAvg7);
    if (!both.length) return [{ label: 'Set-Wert (Trendpreise, täglich)', color: '#8b7cff', points: daily }];
    return [
      {
        label: 'Ø-Verkaufspreise (30 T → 7 T)',
        color: '#2ed8f0',
        points: [
          { t: now - 15 * DAY, v: both.reduce((s, c) => s + c.o.cmAvg30!, 0) },
          { t: now - 3.5 * DAY, v: both.reduce((s, c) => s + c.o.cmAvg7!, 0) },
        ],
      },
    ];
  }, [market, cards, id]);

  const mine = useMemo(() => {
    const byId = new Map(cards.map((c) => [c.o.id, c]));
    return items
      .filter((i) => i.setId === id && !i.cardId.startsWith('cm-'))
      .map((i) => ({ i, c: byId.get(i.cardId) ?? null }));
  }, [items, cards, id]);

  const sorted = useMemo(() => {
    const k = (c: CardStat) => (sort === 'value' ? c.value : sort === 'mom30' ? (c.mom30 ?? -9) : (c.jpPremium ?? 0));
    return [...cards].sort((a, b) => k(b) - k(a));
  }, [cards, sort]);

  if (error) return (<><Header title="Set" back /><ErrorBox message={error} /></>);
  if (!view) return (<><Header title="Set" back /><Spinner label="Wird berechnet…" /></>);
  if (!set) return (<><Header title={id} back /><p className="empty">Für dieses Set gibt es keine erfassten Karten mit Cardmarket-Preis.</p></>);

  const era = ERAS.find((e) => e.key === set.era)!;
  const top = [...cards].sort((a, b) => b.value - a.value).slice(0, 8);
  const lag = laggards(view).filter((x) => x.c.o.setId === id);
  const up = cards.filter((c) => c.value >= 3 && (c.mom30 ?? 0) > 0).sort((a, b) => b.mom30! - a.mom30!).slice(0, 5);
  const down = cards.filter((c) => c.value >= 3 && (c.mom30 ?? 0) < 0).sort((a, b) => a.mom30! - b.mom30!).slice(0, 5);
  const mineValue = mine.reduce((s, m) => s + (m.c?.value ?? 0) * m.i.qty, 0);
  const minePriced = mine.filter((m) => m.c).length;

  return (
    <>
      <Header title={set.name} sub={`${id} · ${era.label} · Rang ${rank} von ${view.sets.length}`} back right={<GearLink />} />

      <section className="panel market-hero">
        <div className="mh-top">
          <Thumb id={set.top?.o.id ?? id} image={null} fallback={`/api/img?set=${encodeURIComponent(id)}`} alt={set.name} className="thumb pack-thumb set-pack" timeout={25000} />
          <div>
            <div className="pf-label">Wert aller {set.cards} erfassten Karten</div>
            <div className="pf-value">{fmtEur(set.value)}</div>
            <div className="mh-chips">
              <Change v={set.change30} label={MOM_LABEL} />
              {seriesChange(indexSeries(market ?? null, [id])) != null && <Change v={seriesChange(indexSeries(market ?? null, [id]))} label="täglich" />}
            </div>
          </div>
        </div>
        <PriceChart height={170} series={series} />
        <p className="hint">
          {series[0]?.label.startsWith('Ø')
            ? 'Summe der Ø-Verkaufspreise der letzten 30 bzw. 7 Tage. Ab drei Scan-Tagen zeigt die Linie den täglichen Set-Wert.'
            : 'Täglicher Set-Wert aus dem Scan.'}
          {set.jpValue > 0 && ` In Japan (Card Rush) kosten die gelisteten Karten zusammen ${fmtEur(set.jpValue)}.`}
        </p>
      </section>

      <AskAi
        ctx={`set:${id}`}
        prompts={['Analysiere dieses Set für mich', 'Welche Karten sind hier unterbewertet?', 'Lohnt sich ein Display aus Japan?', 'Gibt es News oder Reprints zu dem Set?']}
      />

      {mine.length > 0 && (
        <section className="panel">
          <h2>Deine Karten aus diesem Set</h2>
          <div className="row">
            <span className="row-label">
              {mine.reduce((n, m) => n + m.i.qty, 0)} Karten{minePriced < mine.length ? ` (${mine.length - minePriced} ohne Marktpreis)` : ''}
            </span>
            <span className="row-value">{fmtEur(mineValue)}</span>
          </div>
          {mine.map(({ i, c }) => (
            <div className="row" key={i.uid}>
              <span className="row-label">
                {i.nameEn ?? i.nameJa} #{i.number.split('/')[0]} {i.qty > 1 ? `×${i.qty}` : ''}
              </span>
              <span className="row-value">
                {c ? fmtEur(c.value * i.qty) : '–'}
                {c && c.mom30 != null && <small>{pct(c.mom30, 0)} (7T/30T)</small>}
              </span>
            </div>
          ))}
          <p className="hint">Hier mit Cardmarket-Trend bewertet (wie das Ranking). Der Portfolio-Wert nutzt deine Bewertungs-Einstellung.</p>
        </section>
      )}

      <section className="panel">
        <h2>Woraus der Wert besteht</h2>
        {top.map((c) => (
          <div className="share-row" key={c.o.id}>
            <span className="share-name">
              {c.o.nameEn ?? c.o.nameJa} <small>{c.o.number}</small>
            </span>
            <span className="share-val">
              {fmtEur(c.value)} <small>{Math.round((c.value / set.value) * 100)} %</small>
            </span>
            <ShareBar share={c.value / set.value} />
          </div>
        ))}
        <p className="hint">Die {top.length} teuersten Karten machen {Math.round((top.reduce((s, c) => s + c.value, 0) / set.value) * 100)} % des Set-Werts aus.</p>
      </section>

      {(up.length > 0 || down.length > 0) && (
        <>
          <h2 className="section-h">Bewegung (Ø 7 Tage vs. Ø 30 Tage)</h2>
          <ul className="list">
            {up.map((c) => (
              <StatRow key={c.o.id} c={c} why={`Gewinner: Ø 30 T ${fmtEur(c.o.cmAvg30)} → Ø 7 T ${fmtEur(c.o.cmAvg7)}`} />
            ))}
            {down.map((c) => (
              <StatRow key={c.o.id} c={c} why={`Verlierer: Ø 30 T ${fmtEur(c.o.cmAvg30)} → Ø 7 T ${fmtEur(c.o.cmAvg7)}`} />
            ))}
          </ul>
        </>
      )}

      {lag.length > 0 && (
        <>
          <h2 className="section-h">Hinkt hinterher</h2>
          <p className="hint">Das Set hat ein Momentum von {pct(set.change30, 0)} – diese Karten (noch) nicht.</p>
          <ul className="list">
            {lag.map(({ c }) => (
              <StatRow key={c.o.id} c={c} why={`Karte ${pct(c.mom30, 0)} vs. Set ${pct(set.change30, 0)}`} />
            ))}
          </ul>
        </>
      )}

      <h2 className="section-h">Alle Karten ({cards.length})</h2>
      <div className="row-scroll">
        <Chips<CardSort>
          value={sort}
          onChange={setSort}
          options={[
            ['value', 'Wert'],
            ['mom30', 'Momentum'],
            ['jp', 'JP-Prämie'],
          ]}
        />
      </div>
      <ul className="list">
        {(all ? sorted : sorted.slice(0, 20)).map((c) => (
          <StatRow
            key={c.o.id}
            c={c}
            why={c.jpPremium ? `Japan ${fmtEur(c.jpEur)} (×${c.jpPremium.toFixed(1).replace('.', ',')})` : 'Nicht bei Card Rush gelistet'}
          />
        ))}
      </ul>
      {sorted.length > 20 && (
        <button className="link-btn more-btn" onClick={() => setAll(!all)}>
          {all ? 'Weniger zeigen' : `Alle ${sorted.length} Karten zeigen`}
        </button>
      )}
    </>
  );
}
