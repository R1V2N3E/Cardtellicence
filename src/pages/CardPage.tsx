import { AskAi } from '../components/AskAi';
import { openZoom } from '../components/Zoom';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useCardReport, type CardPreview } from '../cardCache';
import type { CardReport, ChartPoint, HistoryFile } from '../../lib/types';
import { api, useAsync } from '../api';
import { PriceChart, type Series } from '../components/PriceChart';
import { Chips, ErrorBox, Header, Spinner } from '../components/ui';
import { ago, cardImg, fmtEur, fmtJpy, fmtPct, fmtSigned, fmtUsd, marginClass, shortDate } from '../format';
import { BUY_LABEL, CHANNEL, computeMargin, costModel, pickBuy, reverseMargin, type Margin, reportBuyOptions, reportSell, SELL_LABEL } from '../margin';
import { useCollection, useSettings, useWatchlist, type BuySource, type SellChannel, type SellRef, type Settings } from '../state';
import { AddSheet } from '../components/AddSheet';
import { CostLines } from '../components/CostLines';

const COLORS = { snk: '#ff9f5a', cm: '#8b7cff', cmAvg: '#b8adff', yyt: '#3ee6a8', pc: '#f472b6', cr: '#ffc24b' };
type Range = 'oneWeek' | 'oneMonth' | 'threeMonths' | 'all';
const RANGE_DAYS: Record<Range, number> = { oneWeek: 7, oneMonth: 31, threeMonths: 92, all: 3650 };

export function CardPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const preview = (useLocation().state as { preview?: CardPreview } | null)?.preview ?? null;
  const { report: r, error } = useCardReport(id, preview);
  const [settings] = useSettings();
  const watch = useWatchlist();
  const [buySource, setBuySource] = useState<BuySource>(settings.buySource);
  const [sellRef, setSellRef] = useState<SellRef>(settings.sellRef);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const collection = useCollection();

  const options = useMemo(() => (r ? reportBuyOptions(r, settings.includeSoldOut) : []), [r, settings.includeSoldOut]);
  const margin = useMemo(
    () => {
      if (!r) return null;
      const sell = reportSell(r, sellRef);
      return { ...computeMargin(pickBuy(options, buySource, !r.partial), sell.eur, r.fx.jpyToEur, costModel(settings)), sellNote: sell.note };
    },
    [r, options, buySource, sellRef, settings],
  );

  // Keep the watchlist snapshot fresh whenever a watched card is opened.
  useEffect(() => {
    if (r && margin && watch.has(r.card.id))
      watch.update(r.card.id, {
        at: r.fetchedAt,
        buyJpy: margin.buy?.jpy ?? null,
        buySource: margin.buy?.label ?? null,
        sellEur: margin.sellEur,
        marginEur: margin.marginEur,
      });
  }, [r, margin]);

  if (!r && error) return (<><Header title="Karte" back /><ErrorBox message={error} /></>);
  if (!r) return <CardSkeleton />;

  const { card, fx } = r;
  const images = [
    cardImg(card.image, 'high') ?? card.externalImage ?? `/api/img?id=${encodeURIComponent(card.id)}&size=high`,
    r.snkrdunk.ok ? r.snkrdunk.image : null,
    r.yuyutei.ok ? r.yuyutei.image : null,
    ...(r.mercari.ok ? r.mercari.items.slice(0, 6).map((i) => i.thumb) : []),
  ].filter(Boolean) as string[];
  const shown = [...new Set(images)].filter((src) => !broken.has(src));
  const watched = watch.has(card.id);
  const owned = collection.items.filter((i) => i.cardId === card.id).reduce((n, i) => n + i.qty, 0);

  return (
    <>
      <Header
        back
        title={card.nameEn ?? card.nameJa}
        sub={`${card.setId} ${card.number} · ${card.setName}`}
        right={
          <button
            className={`icon-btn ${watched ? 'starred' : ''}`}
            aria-label={watched ? 'Von Merkliste entfernen' : 'Zur Merkliste'}
            onClick={() =>
              watch.toggle({
                id: card.id,
                nameJa: card.nameJa,
                nameEn: card.nameEn,
                setId: card.setId,
                number: card.number,
                image: card.image,
                fallbackImage: (r.yuyutei.ok && r.yuyutei.image?.replace('/front/', '/200_280/')) || (r.snkrdunk.ok && r.snkrdunk.image) || null,
              })
            }
          >
            <svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>
          </button>
        }
      />

      <section className="hero">
        {shown[0] && <div className="hero-bg" style={{ backgroundImage: `url("${shown[0]}")` }} aria-hidden="true" />}
        <div className="gallery">
          {shown.map((src, i) => (
            <img
              key={src}
              src={src}
              alt={`${card.nameJa} photo ${i + 1}`}
              onClick={() => openZoom(shown, i, card.nameJa)}
              loading={i ? 'lazy' : 'eager'}
              fetchPriority={i ? 'auto' : 'high'}
              onLoad={(e) => e.currentTarget.classList.add('loaded')}
              onError={() => setBroken((b) => new Set(b).add(src))}
            />
          ))}
          {!shown.length && <div className="thumb ph gallery-ph">Kein Foto verfügbar</div>}
        </div>
        <div className="facts">
          <div className="name-ja">{card.nameJa}</div>
          {r.sell?.nameDe && <span className="badge de-name">🇩🇪 {r.sell.nameDe}</span>}
          {card.rarity && <span className="badge">{card.rarity}</span>}
          {card.illustrator && <div className="muted">Illustration: {card.illustrator}</div>}
          {card.releaseDate && <div className="muted">Erschienen {new Date(card.releaseDate).toLocaleDateString('de-DE')}</div>}
        </div>
        <button className="primary-btn" onClick={() => setAdding(true)}>
          + Zur Sammlung{owned ? ` (${owned} im Besitz)` : ''}
        </button>
      </section>

      <AskAi
        ctx={`card:${card.id}`}
        prompts={[
          'Lohnt sich der Kauf in Japan gerade?',
          'Wo verkaufe ich diese Karte am besten?',
          'Wie hat sich der Preis entwickelt – und warum?',
          'Schreib mir ein Inserat dafür',
          owned ? 'Wann kann ich sie steuerfrei verkaufen?' : 'Was ist ein guter Preis im Laden in Japan?',
        ]}
      />

      {/* Margin calculator */}
      <section className="panel margin-panel">
        <div className="margin-flow">
          <div>
            <small>Kauf in Japan</small>
            {r.partial && !margin?.buy ? (
              <>
                <span className="sk sk-value" style={{ height: 26, margin: '4px 0' }} />
                <span className="muted">lädt…</span>
              </>
            ) : (
              <>
                <strong>{fmtJpy(margin?.buy?.jpy)}</strong>
                <span className="muted">≈ {fmtEur(margin?.buyEur)} · {margin?.buy?.label ?? 'kein Angebot'}</span>
              </>
            )}
          </div>
          <div className="arrow">→</div>
          <div>
            <small>Verkauf auf Cardmarket</small>
            <strong>{fmtEur(margin?.sellEur)}</strong>
            <span className="muted">{margin?.sellNote ?? SELL_LABEL[sellRef]}</span>
          </div>
        </div>
        {margin?.costs && <CostLines m={margin} />}
        <div className={`margin-result ${marginClass(margin?.marginEur)}`}>
          <span>{margin?.costs ? 'Netto-Marge' : 'Marge'}</span>
          <strong>{fmtSigned(margin?.marginEur)}</strong>
          <span>{fmtPct(margin?.roi)} ROI</span>
        </div>
        <div className="row-scroll">
          <Chips<BuySource> value={buySource} onChange={setBuySource} options={(Object.keys(BUY_LABEL) as BuySource[]).map((k) => [k, BUY_LABEL[k]])} />
        </div>
        <div className="row-scroll">
          <Chips<SellRef> value={sellRef} onChange={setSellRef} options={(Object.keys(SELL_LABEL) as SellRef[]).map((k) => [k, SELL_LABEL[k]])} />
        </div>
        {fx.jpyToEur > 0 && (
          <p className="hint">
            Kurs: 1 € = {fmtJpy(1 / fx.jpyToEur)} (EZB {fx.date}). {margin?.costs ? 'Kosten laut Einstellungen.' : 'Brutto: Gebühren, Versand und Einfuhr-USt. nicht enthalten.'}
          </p>
        )}
        {r.partial && <p className="hint loading-line">Japan-Preise werden geladen…</p>}
      </section>

      <ReverseCheck r={r} settings={settings} />
      <PriceTables r={r} />
      {r.sell && (
        <section className="panel">
          <h2>🇩🇪 Verkaufen in Deutschland</h2>
          <div className="sell-grid">
            <a className="sell-btn primary" href={r.sell.ebaySold} target="_blank" rel="noreferrer">
              <b>eBay.de</b>
              <span>verkaufte Artikel</span>
            </a>
            <a className="sell-btn" href={r.sell.ebayLive} target="_blank" rel="noreferrer">
              <b>eBay.de</b>
              <span>aktuelle Angebote</span>
            </a>
            <a className="sell-btn" href={r.sell.kleinanzeigen} target="_blank" rel="noreferrer">
              <b>Kleinanzeigen</b>
              <span>Angebote</span>
            </a>
            {r.cardmarket.url && (
              <a className="sell-btn" href={r.cardmarket.url} target="_blank" rel="noreferrer">
                <b>Cardmarket</b>
                <span>{r.cardmarket.ok && r.cardmarket.trend ? `Trend ${fmtEur(r.cardmarket.trend)}` : 'Angebote'}</span>
              </a>
            )}
          </div>
          <p className="hint">Suche: „{r.sell.query}“. eBay und Kleinanzeigen erlauben kein automatisches Auslesen, daher direkte Links.</p>
        </section>
      )}
      {margin && <SellCalculator margin={margin} />}
      <Charts r={r} />
      <RecentSales r={r} />
      <Graded r={r} settings={settings} />

      {Object.keys(r.links).length > 0 && (
      <section className="panel">
        <h2>Öffnen bei</h2>
        <div className="links">
          {Object.entries(r.links).map(([label, url]) => (
            <a key={label} href={url} target="_blank" rel="noreferrer" className="link-btn">
              {label} ↗
            </a>
          ))}
        </div>
        <p className="hint">Preise abgerufen {ago(r.fetchedAt)}. Cardmarket = offizieller Tages-Preisguide der japanischen Ausgabe.</p>
      </section>
      )}

      {adding && <AddSheet card={card} photo={shown[0]} priceEur={r.cardmarket.ok ? r.cardmarket.trend : null} onClose={() => setAdding(false)} />}

    </>
  );
}

function Row({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <>
      <span className="row-label">{label}</span>
      <span className="row-value">
        {value}
        {sub && <small>{sub}</small>}
      </span>
    </>
  );
  return href ? (
    <a className="row" href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className="row">{body}</div>
  );
}

function Unavailable({ label, res }: { label: string; res: { ok: false; error: string; url?: string; pending?: boolean } }) {
  if (res.pending) return <SkeletonRow label={label} />;
  return <Row label={label} value="–" sub={res.error} href={res.url} />;
}

function SkeletonRow({ label }: { label: string }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="sk sk-value" />
    </div>
  );
}

/** Shown only when nothing at all is known yet (e.g. a card opened from a shared link). */
function CardSkeleton() {
  return (
    <>
      <Header title="Karte" back />
      <section className="hero">
        <div className="gallery">
          <div className="sk sk-card" />
        </div>
        <div className="sk sk-line" style={{ width: '60%' }} />
        <div className="sk sk-line" style={{ width: '40%' }} />
      </section>
      {[0, 1, 2].map((i) => (
        <section key={i} className="panel">
          <div className="sk sk-line" style={{ width: '45%' }} />
          <div className="sk sk-line" />
          <div className="sk sk-line" />
        </section>
      ))}
    </>
  );
}

function PriceTables({ r }: { r: CardReport }) {
  const eur = (jpy: number | null | undefined) => (jpy ? `≈ ${fmtEur(jpy * r.fx.jpyToEur)}` : undefined);
  const cm = r.cardmarket;
  return (
    <>
      <section className="panel">
        <h2>🇩🇪 Cardmarket (Verkauf)</h2>
        {cm.ok ? (
          <>
            <Row label="Preistrend" value={fmtEur(cm.trend)} href={cm.url} />
            <Row label="30-Tage-Durchschnitt" value={fmtEur(cm.avg30)} />
            <Row label="7-Tage-Durchschnitt" value={fmtEur(cm.avg7)} />
            <Row label="1-Tages-Durchschnitt" value={fmtEur(cm.avg1)} />
            <Row label="Günstigstes Angebot" value={fmtEur(cm.low)} />
            {cm.matched === 'name' && <p className="hint">Produkt über die Position im Set zugeordnet. Vor dem Verkauf das Angebot prüfen.</p>}
          </>
        ) : (
          <Unavailable label="Cardmarket" res={cm} />
        )}
      </section>
      <section className="panel">
        <h2>🇯🇵 Japan (Einkauf)</h2>
        {r.cardrush.ok ? (
          <>
            <Row
              label="Card Rush Verkaufspreis"
              value={fmtJpy(r.cardrush.priceJpy)}
              sub={`${eur(r.cardrush.priceJpy)} · ${r.cardrush.stock === 0 ? 'ausverkauft' : `${r.cardrush.stock} auf Lager`} · Stand ${ago(r.cardrush.updatedAt)}`}
              href={r.cardrush.url}
            />
            <Row label="Card Rush Ankauf (買取)" value={fmtJpy(r.cardrush.buyJpy)} sub={eur(r.cardrush.buyJpy)} />
          </>
        ) : (
          <Unavailable label="Card Rush" res={r.cardrush} />
        )}
        {r.yuyutei.ok ? (
          <Row
            label="Yuyu-tei Shoppreis"
            value={fmtJpy(r.yuyutei.priceJpy)}
            sub={`${eur(r.yuyutei.priceJpy)} · ${r.yuyutei.stock === 0 ? 'ausverkauft' : r.yuyutei.stock != null ? `${r.yuyutei.stock} auf Lager` : 'Bestand unbekannt'}${r.yuyutei.asOf ? ` · Tages-Scan ${ago(r.yuyutei.asOf)}` : ''}`}
            href={r.yuyutei.url}
          />
        ) : (
          <Unavailable label="Yuyu-tei" res={r.yuyutei} />
        )}
        {r.snkrdunk.ok ? (
          <>
            <Row label="SNKRDUNK günstigstes Angebot" value={fmtJpy(r.snkrdunk.lowestAskJpy)} sub={`${eur(r.snkrdunk.lowestAskJpy) ?? ''} · ${r.snkrdunk.listingCount ?? '?'} Angebote`} href={r.snkrdunk.url} />
            <Row label="SNKRDUNK verkauft (A, 1-Monats-Median)" value={fmtJpy(r.snkrdunk.rawMedianJpy)} sub={eur(r.snkrdunk.rawMedianJpy)} />
          </>
        ) : (
          <Unavailable label="SNKRDUNK" res={r.snkrdunk} />
        )}
        {r.mercari.ok ? (
          <>
            <Row label="Mercari verkauft (Median)" value={fmtJpy(r.mercari.soldMedianJpy)} sub={`${eur(r.mercari.soldMedianJpy) ?? ''} · ${r.mercari.soldCount} verkauft`} href={r.mercari.url} />
            <Row label="Mercari günstigstes Angebot" value={fmtJpy(r.mercari.activeLowestJpy)} sub={eur(r.mercari.activeLowestJpy)} />
          </>
        ) : (
          <Unavailable label="Mercari" res={r.mercari} />
        )}
      </section>
    </>
  );
}

function Charts({ r }: { r: CardReport }) {
  const [mode, setMode] = useState<'raw' | 'psa10'>('raw');
  const [range, setRange] = useState<Range>('threeMonths');
  const snkId = r.snkrdunk.ok ? r.snkrdunk.id : null;
  const snk = useAsync<ChartPoint[]>(() => (snkId ? api.snkChart(snkId, mode, range) : Promise.resolve([])), [snkId, mode, range]);
  const hist = useAsync<HistoryFile>(() => api.history(r.card.setId), [r.card.setId]);
  const pc = useAsync(() => (mode === 'psa10' && r.pricecharting.ok ? api.pcChart(r.card.id) : Promise.resolve(null)), [mode, r.card.id]);

  const series = useMemo<Series[]>(() => {
    const from = Date.now() - RANGE_DAYS[range] * 86400_000;
    const inRange = (p: ChartPoint[]) => p.filter((x) => x.t >= from);
    const jpy = (p: ChartPoint[]) => p.map((x) => ({ t: x.t, v: x.v * r.fx.jpyToEur }));
    const out: Series[] = [{ label: mode === 'raw' ? 'SNKRDUNK verkauft (A)' : 'SNKRDUNK verkauft PSA10', points: jpy(snk.data ?? []), color: COLORS.snk }];
    if (mode === 'raw') {
      const rows = hist.data?.[r.card.id] ?? [];
      const at = (d: string) => Date.parse(d);
      out.push({ label: 'Cardmarket-Trend', points: inRange(rows.filter((x) => x[1] != null).map((x) => ({ t: at(x[0]), v: x[1]! }))), color: COLORS.cm });
      const crPoints = rows.filter((x) => x[4] != null).map((x) => ({ t: at(x[0]), v: x[4]! * r.fx.jpyToEur }));
      if (r.cardrush.ok) crPoints.push({ t: Date.now(), v: r.cardrush.priceJpy * r.fx.jpyToEur });
      out.push({ label: 'Card Rush', points: inRange(crPoints), color: COLORS.cr, stepped: true });
      out.push({ label: 'Yuyu-tei', points: inRange(rows.filter((x) => x[3] != null).map((x) => ({ t: at(x[0]), v: x[3]! * r.fx.jpyToEur }))), color: COLORS.yyt, stepped: true });
      // Current Cardmarket levels as reference lines across the visible range.
      if (r.cardmarket.ok && r.cardmarket.trend) {
        const start = Math.max(from, (snk.data?.[0]?.t ?? Date.now() - 30 * 86400_000));
        out.push({ label: 'Cardmarket-Trend aktuell', points: [{ t: start, v: r.cardmarket.trend }, { t: Date.now(), v: r.cardmarket.trend }], color: COLORS.cmAvg, dashed: true });
      }
    } else if (pc.data) {
      const usd = (p: ChartPoint[]) => p.map((x) => ({ t: x.t, v: x.v * r.fx.usdToEur }));
      out.push({ label: 'PriceCharting PSA10 (eBay)', points: inRange(usd(pc.data.psa10)), color: COLORS.pc });
    }
    return out;
  }, [snk.data, hist.data, pc.data, mode, range, r]);

  return (
    <section className="panel">
      <h2>Preisverlauf</h2>
      <div className="row-scroll">
        <Chips value={mode} onChange={setMode} options={[['raw', 'Roh'], ['psa10', 'PSA 10']]} />
        <Chips<Range> value={range} onChange={setRange} options={[['oneWeek', '1W'], ['oneMonth', '1M'], ['threeMonths', '3M'], ['all', 'All']]} />
      </div>
      {(snk.loading && !snk.data) || (!r.snkrdunk.ok && r.snkrdunk.pending) ? <div className="sk sk-chart" /> : <PriceChart series={series} />}
      <p className="hint">Alle Werte in EUR zum heutigen EZB-Kurs. Der Verlauf für Cardmarket und Yuyu-tei wächst mit dem täglichen Scan.</p>
    </section>
  );
}

function SkeletonList() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <li key={i}>
          <span className="sk sk-line" style={{ width: '100%', gridColumn: '1 / -1' }} />
        </li>
      ))}
    </>
  );
}

function RecentSales({ r }: { r: CardReport }) {
  const [tab, setTab] = useState<'snk' | 'mercari'>('snk');
  const trades = r.snkrdunk.ok ? r.snkrdunk.trades : [];
  const mercari = r.mercari.ok ? r.mercari.items : [];
  return (
    <section className="panel">
      <h2>Letzte Verkäufe in Japan</h2>
      <Chips value={tab} onChange={setTab} options={[['snk', `SNKRDUNK (${trades.length})`], ['mercari', `Mercari (${mercari.length})`]]} />
      {tab === 'snk' && (
        <ul className="sales">
          {trades.map((t, i) => (
            <li key={i}>
              <span className="badge small">{t.condition}</span>
              <span className="muted">{shortDate(t.soldAt)}</span>
              <strong>{fmtJpy(t.priceJpy)}</strong>
              <span className="muted">{fmtEur(t.priceJpy * r.fx.jpyToEur)}</span>
            </li>
          ))}
          {!r.snkrdunk.ok && r.snkrdunk.pending ? <SkeletonList /> : !trades.length && <li className="muted">Keine aktuellen Verkäufe{!r.snkrdunk.ok ? ` (${r.snkrdunk.error})` : ''}.</li>}
        </ul>
      )}
      {tab === 'mercari' && (
        <ul className="sales">
          {mercari.map((m) => (
            <li key={m.id}>
              <a href={m.url} target="_blank" rel="noreferrer" className="mercari-item">
                {m.thumb && <img src={m.thumb} alt="" loading="lazy" />}
                <span className="m-name">{m.name}</span>
                <span className={m.sold ? 'badge small' : 'badge small live'}>{m.sold ? 'verkauft' : 'zu kaufen'}</span>
                <strong>{fmtJpy(m.priceJpy)}</strong>
              </a>
            </li>
          ))}
          {!r.mercari.ok && r.mercari.pending ? <SkeletonList /> : !mercari.length && <li className="muted">Keine passenden Angebote{!r.mercari.ok ? ` (${r.mercari.error})` : ''}.</li>}
        </ul>
      )}
    </section>
  );
}

/** The other direction: buy this card in Germany and sell it to Card Rush. */
function ReverseCheck({ r, settings }: { r: CardReport; settings: Settings }) {
  if (!r.cardmarket.ok || !r.cardrush.ok || !r.cardrush.buyJpy) return null;
  const d = reverseMargin({ cmTrend: r.cardmarket.trend, cmAvg30: r.cardmarket.avg30, cmLow: r.cardmarket.low, crBuyJpy: r.cardrush.buyJpy }, settings, r.fx.jpyToEur);
  if (!d) return null;
  return (
    <section className="panel">
      <h2>🇩🇪 → 🇯🇵 Kauf in DE, Verkauf an Card Rush</h2>
      <div className="margin-flow">
        <div>
          <small>Kauf Cardmarket</small>
          <strong>{fmtEur(d.buyEur)}</strong>
          <span className="muted">{SELL_LABEL[settings.revBuyRef]}{d.costEur - d.buyEur > 0.005 ? ` + ${fmtEur(d.costEur - d.buyEur)} Kosten` : ''}</span>
        </div>
        <div className="arrow">→</div>
        <div>
          <small>Card Rush Ankauf</small>
          <strong>{fmtJpy(r.cardrush.buyJpy)}</strong>
          <span className="muted">≈ {fmtEur(d.payoutEur)}</span>
        </div>
      </div>
      <div className={`margin-result ${marginClass(d.marginEur)}`}>
        <span>Marge</span>
        <strong>{fmtSigned(d.marginEur)}</strong>
        <span>{fmtPct(d.roi)} ROI</span>
      </div>
    </section>
  );
}

/** What stays after each German sales channel, against what the card cost landed. */
function SellCalculator({ margin }: { margin: Margin }) {
  const [price, setPrice] = useState('');
  const base = margin.sellEur ?? null;
  const p = Number(price.replace(',', '.')) || base;
  if (!p) return null;
  const cost = margin.landedEur;
  return (
    <section className="panel">
      <h2>Verkaufsrechner</h2>
      <label className="field">
        Verkaufspreis
        <span className="num-input">
          <input className="input" inputMode="decimal" placeholder={base ? base.toFixed(2) : ''} value={price} onChange={(e) => setPrice(e.target.value)} />
          <span>€</span>
        </span>
      </label>
      {(Object.keys(CHANNEL) as SellChannel[]).map((k) => {
        const fee = (p * CHANNEL[k].feePct) / 100;
        const net = p - fee;
        return (
          <div className="row" key={k}>
            <span className="row-label">{CHANNEL[k].label}</span>
            <span className="row-value">
              {fmtEur(net)}
              {cost != null && <small className={net - cost >= 0 ? 'up' : 'down'}>{fmtSigned(net - cost)} Gewinn</small>}
            </span>
          </div>
        );
      })}
      <p className="hint">
        Erlös nach Verkaufsgebühr; Gewinn gegen {cost != null ? `${fmtEur(cost)} Einstand (${margin.buy?.label ?? 'Kauf'}${margin.costs ? ' inkl. Kosten' : ''})` : 'den Kaufpreis'}. Versand zahlt der Käufer.
      </p>
    </section>
  );
}

function Graded({ r, settings }: { r: CardReport; settings: Settings }) {
  const s = r.snkrdunk.ok ? r.snkrdunk : null;
  const p = r.pricecharting.ok ? r.pricecharting : null;
  if (!s?.psa10MedianJpy && !p) return null;
  const jp10 = s?.psa10MedianJpy ? s.psa10MedianJpy * r.fx.jpyToEur : null;
  const intl10 = p?.psa10Usd ? p.psa10Usd * r.fx.usdToEur : null;
  return (
    <section className="panel">
      <h2>Gegradet (PSA)</h2>
      <Row label="🇯🇵 SNKRDUNK PSA10 verkauft" value={fmtJpy(s?.psa10MedianJpy)} sub={jp10 ? `≈ ${fmtEur(jp10)}` : undefined} />
      <Row label="🇯🇵 SNKRDUNK PSA9 verkauft" value={fmtJpy(s?.psa9MedianJpy)} sub={s?.psa9MedianJpy ? `≈ ${fmtEur(s.psa9MedianJpy * r.fx.jpyToEur)}` : undefined} />
      {p && (
        <>
          <Row label="🌍 PSA10 (eBay, PriceCharting)" value={fmtUsd(p.psa10Usd)} sub={intl10 ? `≈ ${fmtEur(intl10)}` : undefined} href={p.url} />
          <Row label="🌍 Grade 9" value={fmtUsd(p.grade9Usd)} sub={p.grade9Usd ? `≈ ${fmtEur(p.grade9Usd * r.fx.usdToEur)}` : undefined} />
          <Row label="🌍 Ungegradet" value={fmtUsd(p.ungradedUsd)} sub={p.ungradedUsd ? `≈ ${fmtEur(p.ungradedUsd * r.fx.usdToEur)}` : undefined} />
        </>
      )}
      {jp10 && intl10 && (
        <div className={`margin-result ${marginClass(intl10 - jp10)}`}>
          <span>PSA10-Differenz</span>
          <strong>{fmtSigned(intl10 - jp10)}</strong>
          <span>{fmtPct((intl10 - jp10) / jp10)}</span>
        </div>
      )}
      <GradingCalc r={r} settings={settings} jp10={jp10} intl10={intl10} />
      <p className="hint">Cardmarket hat keinen Preisguide für gegradete Karten; eBay-Verkäufe (PriceCharting) dienen als internationale Referenz.</p>
    </section>
  );
}

/** Is grading worth it? Expected value of a graded copy against selling it raw. */
function GradingCalc({ r, settings, jp10, intl10 }: { r: CardReport; settings: Settings; jp10: number | null; intl10: number | null }) {
  const s = r.snkrdunk.ok ? r.snkrdunk : null;
  const p = r.pricecharting.ok ? r.pricecharting : null;
  const raw = (r.cardmarket.ok ? r.cardmarket.trend : null) ?? (p?.ungradedUsd ? p.ungradedUsd * r.fx.usdToEur : null);
  const psa10 = intl10 ?? jp10;
  const psa9 = (p?.grade9Usd ? p.grade9Usd * r.fx.usdToEur : null) ?? (s?.psa9MedianJpy ? s.psa9MedianJpy * r.fx.jpyToEur : null) ?? raw;
  if (!raw || !psa10 || !psa9) return null;
  const chance = Math.min(100, settings.psa10Pct) / 100;
  const expected = chance * psa10 + (1 - chance) * psa9 - settings.gradingEur;
  const gain = expected - raw;
  return (
    <>
      <h2 className="sub-h2">Lohnt sich Grading?</h2>
      <div className="cost-lines">
        <div>
          <span>Roh verkaufen</span>
          <b>{fmtEur(raw)}</b>
        </div>
        <div>
          <span>
            Graden: {Math.round(chance * 100)} % × PSA10 {fmtEur(psa10)} + {Math.round((1 - chance) * 100)} % × PSA9 {fmtEur(psa9)} − {fmtEur(settings.gradingEur)}
          </span>
          <b>{fmtEur(expected)}</b>
        </div>
      </div>
      <div className={`margin-result ${marginClass(gain)}`}>
        <span>{gain > 0 ? 'Grading lohnt sich' : 'Lieber roh verkaufen'}</span>
        <strong>{fmtSigned(gain)}</strong>
        <span>erwartet</span>
      </div>
    </>
  );
}
