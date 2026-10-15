import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useCardReport, type CardPreview } from '../cardCache';
import type { CardReport, ChartPoint, HistoryFile } from '../../lib/types';
import { api, useAsync } from '../api';
import { PriceChart, type Series } from '../components/PriceChart';
import { Chips, ErrorBox, Header, Spinner } from '../components/ui';
import { ago, cardImg, fmtEur, fmtJpy, fmtPct, fmtSigned, fmtUsd, marginClass, shortDate } from '../format';
import { BUY_LABEL, computeMargin, pickBuy, reportBuyOptions, reportSell, SELL_LABEL } from '../margin';
import { useCollection, useSettings, useWatchlist, type BuySource, type SellRef } from '../state';
import { AddSheet } from '../components/AddSheet';

const COLORS = { snk: '#ff9f5a', cm: '#8b7cff', cmAvg: '#b8adff', yyt: '#3ee6a8', pc: '#f472b6' };
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
  const [viewer, setViewer] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const collection = useCollection();

  const options = useMemo(() => (r ? reportBuyOptions(r, settings.includeSoldOut) : []), [r, settings.includeSoldOut]);
  const margin = useMemo(
    () => (r ? computeMargin(pickBuy(options, buySource), reportSell(r, sellRef), r.fx.jpyToEur) : null),
    [r, options, buySource, sellRef],
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
              onClick={() => setViewer(i)}
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
            <span className="muted">{SELL_LABEL[sellRef]}</span>
          </div>
        </div>
        <div className={`margin-result ${marginClass(margin?.marginEur)}`}>
          <span>Marge</span>
          <strong>{fmtSigned(margin?.marginEur)}</strong>
          <span>{fmtPct(margin?.roi)} ROI</span>
        </div>
        <div className="row-scroll">
          <Chips<BuySource> value={buySource} onChange={setBuySource} options={(Object.keys(BUY_LABEL) as BuySource[]).map((k) => [k, BUY_LABEL[k]])} />
        </div>
        <div className="row-scroll">
          <Chips<SellRef> value={sellRef} onChange={setSellRef} options={(Object.keys(SELL_LABEL) as SellRef[]).map((k) => [k, SELL_LABEL[k]])} />
        </div>
        {fx.jpyToEur > 0 && <p className="hint">Kurs: 1 € = {fmtJpy(1 / fx.jpyToEur)} (EZB {fx.date}). Gebühren, Versand und Einfuhr-USt. nicht enthalten.</p>}
        {r.partial && <p className="hint loading-line">Japan-Preise werden geladen…</p>}
      </section>

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
      <Charts r={r} />
      <RecentSales r={r} />
      <Graded r={r} />

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

      {adding && <AddSheet card={card} priceEur={r.cardmarket.ok ? r.cardmarket.trend : null} onClose={() => setAdding(false)} />}

      {viewer != null && (
        <div className="viewer" onClick={() => setViewer(null)} role="dialog" aria-label="Fotos">
          <div className="viewer-strip" ref={(el) => el?.children[viewer]?.scrollIntoView({ inline: 'center' })}>
            {shown.map((src) => (
              <img key={src} src={src.replace('/low.webp', '/high.webp')} alt="" />
            ))}
          </div>
          <div className="viewer-hint">Wischen für mehr · tippen zum Schließen</div>
        </div>
      )}
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

function Graded({ r }: { r: CardReport }) {
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
      <p className="hint">Cardmarket hat keinen Preisguide für gegradete Karten; eBay-Verkäufe (PriceCharting) dienen als internationale Referenz.</p>
    </section>
  );
}
