import { useMemo, useState } from 'react';
import type { FxRates, SealedItem } from '../../lib/types';
import { api, useAsync } from '../api';
import { fmtEur, fmtJpy, fmtPct, fmtSigned, marginClass } from '../format';
import { computeMargin, costModel, pickBuy, sealedBuyOptions } from '../margin';
import type { Settings, SellRef } from '../state';
import { AddSheet } from './AddSheet';
import { CostLines } from './CostLines';
import { PriceChart } from './PriceChart';
import { Chips, Thumb } from './ui';

export const sealedLabel = (s: SealedItem) => (s.kind === 'box' ? 'Display (Box)' : 'Booster (Pack)');

export function sealedSell(s: SealedItem, ref: SellRef) {
  return ref === 'avg30' ? s.cmAvg30 ?? s.cmTrend : ref === 'low' ? s.cmLow ?? s.cmTrend : s.cmTrend;
}

export function sealedMargin(s: SealedItem, settings: Settings, fx: FxRates) {
  return computeMargin(pickBuy(sealedBuyOptions(s, settings.includeSoldOut), settings.buySource, true), sealedSell(s, settings.sellRef), fx.jpyToEur, costModel(settings, true));
}

type Range = 'oneMonth' | 'threeMonths' | 'all';

/** Detail sheet for a booster box / pack: prices, margin, sold-price chart, links, add to collection. */
export function SealedSheet({ item, fx, settings, onClose }: { item: SealedItem; fx: FxRates; settings: Settings; onClose: () => void }) {
  const [range, setRange] = useState<Range>('threeMonths');
  const [adding, setAdding] = useState(false);
  const m = sealedMargin(item, settings, fx);
  const chart = useAsync(() => (item.snkId ? api.sealedChart(item.snkId, range) : Promise.resolve([])), [item.snkId, range]);
  const series = useMemo(() => {
    const pts = (chart.data ?? []).map((p) => ({ t: p.t, v: p.v * fx.jpyToEur }));
    const out = [{ label: 'SNKRDUNK verkauft', color: '#ff9f5a', points: pts }];
    if (item.cmTrend && pts.length)
      out.push({ label: 'Cardmarket-Trend aktuell', color: '#b8adff', points: [{ t: pts[0].t, v: item.cmTrend }, { t: Date.now(), v: item.cmTrend }], dashed: true } as never);
    return out;
  }, [chart.data, item, fx]);

  if (adding)
    return (
      <AddSheet
        card={{
          id: item.id,
          setId: item.setId,
          setName: item.setName,
          localId: '',
          number: sealedLabel(item),
          nameJa: `${item.setName} ${item.kind === 'box' ? 'ボックス' : 'パック'}`,
          nameEn: item.nameEn,
          rarity: null,
          image: null,
          externalImage: item.image,
        }}
        priceEur={item.cmTrend}
        onClose={onClose}
      />
    );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sealed-head">
          <Thumb id={item.id} image={null} fallback={item.image ?? `/api/img?set=${encodeURIComponent(item.setId)}`} alt={item.nameEn} className="thumb sealed-thumb pack-thumb" />
          <div>
            <div className="deal-name big">{item.nameEn}</div>
            <div className="deal-meta">
              {item.setId} · {item.setName} · {sealedLabel(item)}
            </div>
          </div>
        </div>
        <div className="margin-flow">
          <div>
            <small>Kauf in Japan</small>
            <strong>{fmtJpy(m.buy?.jpy)}</strong>
            <span className="muted">≈ {fmtEur(m.buyEur)} · {m.buy ? `${m.buy.label}${m.buy.note ? ` (${m.buy.note})` : ''}` : 'kein Angebot'}</span>
          </div>
          <div className="arrow">→</div>
          <div>
            <small>Verkauf Cardmarket</small>
            <strong>{fmtEur(m.sellEur)}</strong>
            <span className="muted">30T-Ø {fmtEur(item.cmAvg30)} · min. {fmtEur(item.cmLow)}</span>
          </div>
        </div>
        {m.costs && <CostLines m={m} />}
        <div className={`margin-result ${marginClass(m.marginEur)}`}>
          <span>{m.costs ? 'Netto-Marge' : 'Marge'}</span>
          <strong>{fmtSigned(m.marginEur)}</strong>
          <span>{fmtPct(m.roi)} ROI</span>
        </div>
        {item.snkId && (
          <>
            <div className="pf-chart-head">
              <h2 className="sheet-h2">Verkaufspreise Japan</h2>
              <Chips<Range> value={range} onChange={setRange} options={[['oneMonth', '1M'], ['threeMonths', '3M'], ['all', 'Alle']]} />
            </div>
            {chart.loading && !chart.data ? <div className="sk sk-chart" /> : <PriceChart height={180} series={series} />}
          </>
        )}
        {item.crJpy != null && (
          <p className="hint">
            Card Rush: Verkauf {fmtJpy(item.crJpy)} ({item.crStock ? `${item.crStock} auf Lager` : 'ausverkauft'}) · Ankauf {fmtJpy(item.crBuyJpy)}
          </p>
        )}
        <div className="links">
          {item.crUrl && (
            <a className="link-btn" href={item.crUrl} target="_blank" rel="noreferrer">
              Card Rush ↗
            </a>
          )}
          <a className="link-btn" href={item.cmUrl} target="_blank" rel="noreferrer">
            Cardmarket ↗
          </a>
          {item.snkId && (
            <a className="link-btn" href={`https://snkrdunk.com/apparels/${item.snkId}`} target="_blank" rel="noreferrer">
              SNKRDUNK ↗
            </a>
          )}
        </div>
        <button className="primary-btn" onClick={() => setAdding(true)}>
          + Zur Sammlung
        </button>
        <p className="hint">Cardmarket = offizieller Preisguide der japanischen Ausgabe. {m.costs ? 'Netto: Kosten laut Einstellungen.' : 'Brutto: Gebühren, Versand und Einfuhr-USt. nicht enthalten.'}</p>
      </div>
    </div>
  );
}
