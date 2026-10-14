import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { CardReport, ChartPoint, HistoryFile } from '../../lib/types';
import { api, useAsync } from '../api';
import { PriceChart, type Series } from '../components/PriceChart';
import { Chips, ErrorBox, Header, Spinner } from '../components/ui';
import { ago, cardImg, fmtEur, fmtJpy, fmtPct, fmtSigned, fmtUsd, marginClass, shortDate } from '../format';
import { BUY_LABEL, computeMargin, pickBuy, reportBuyOptions, reportSell, SELL_LABEL } from '../margin';
import { useSettings, useWatchlist, type BuySource, type SellRef } from '../state';

const COLORS = { snk: '#ff7a45', cm: '#4f8cff', cmAvg: '#8fb3ff', yyt: '#2ec27e', pc: '#c061cb' };
type Range = 'oneWeek' | 'oneMonth' | 'threeMonths' | 'all';
const RANGE_DAYS: Record<Range, number> = { oneWeek: 7, oneMonth: 31, threeMonths: 92, all: 3650 };

export function CardPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { data: r, error, loading } = useAsync(() => api.card(id), [id]);
  const [settings] = useSettings();
  const watch = useWatchlist();
  const [buySource, setBuySource] = useState<BuySource>(settings.buySource);
  const [sellRef, setSellRef] = useState<SellRef>(settings.sellRef);
  const [viewer, setViewer] = useState<number | null>(null);

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

  if (loading && !r) return (<><Header title="Card" back /><Spinner label="Checking Cardmarket, Yuyu-tei, SNKRDUNK, Mercari…" /></>);
  if (error || !r) return (<><Header title="Card" back /><ErrorBox message={error ?? 'Not found'} /></>);

  const { card, fx } = r;
  const images = [
    cardImg(card.image, 'high'),
    r.snkrdunk.ok ? r.snkrdunk.image : null,
    r.yuyutei.ok ? r.yuyutei.image : null,
    ...(r.mercari.ok ? r.mercari.items.slice(0, 6).map((i) => i.thumb) : []),
  ].filter(Boolean) as string[];
  const watched = watch.has(card.id);

  return (
    <>
      <Header
        back
        title={card.nameEn ?? card.nameJa}
        sub={`${card.setId} ${card.number} · ${card.setName}`}
        right={
          <button
            className={`icon-btn ${watched ? 'starred' : ''}`}
            aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
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
        <div className="gallery">
          {images.map((src, i) => (
            <img key={src} src={src} alt={`${card.nameJa} photo ${i + 1}`} onClick={() => setViewer(i)} loading={i ? 'lazy' : 'eager'} />
          ))}
        </div>
        <div className="facts">
          <div className="name-ja">{card.nameJa}</div>
          {card.rarity && <span className="badge">{card.rarity}</span>}
          {card.illustrator && <div className="muted">Illus. {card.illustrator}</div>}
          {card.releaseDate && <div className="muted">Released {card.releaseDate}</div>}
        </div>
      </section>

      {/* Margin calculator */}
      <section className="panel margin-panel">
        <div className="margin-flow">
          <div>
            <small>Buy in Japan</small>
            <strong>{fmtJpy(margin?.buy?.jpy)}</strong>
            <span className="muted">≈ {fmtEur(margin?.buyEur)} · {margin?.buy?.label ?? 'no offer'}</span>
          </div>
          <div className="arrow">→</div>
          <div>
            <small>Sell on Cardmarket</small>
            <strong>{fmtEur(margin?.sellEur)}</strong>
            <span className="muted">{SELL_LABEL[sellRef]}</span>
          </div>
        </div>
        <div className={`margin-result ${marginClass(margin?.marginEur)}`}>
          <span>Margin</span>
          <strong>{fmtSigned(margin?.marginEur)}</strong>
          <span>{fmtPct(margin?.roi)} ROI</span>
        </div>
        <div className="row-scroll">
          <Chips<BuySource> value={buySource} onChange={setBuySource} options={(Object.keys(BUY_LABEL) as BuySource[]).map((k) => [k, BUY_LABEL[k]])} />
        </div>
        <div className="row-scroll">
          <Chips<SellRef> value={sellRef} onChange={setSellRef} options={(Object.keys(SELL_LABEL) as SellRef[]).map((k) => [k, SELL_LABEL[k]])} />
        </div>
        <p className="hint">Rate: 1 € = {fmtJpy(1 / fx.jpyToEur)} (ECB {fx.date}). Fees, shipping and import VAT not included.</p>
      </section>

      <PriceTables r={r} />
      <Charts r={r} />
      <RecentSales r={r} />
      <Graded r={r} />

      <section className="panel">
        <h2>Open on</h2>
        <div className="links">
          {Object.entries(r.links).map(([label, url]) => (
            <a key={label} href={url} target="_blank" rel="noreferrer" className="link-btn">
              {label} ↗
            </a>
          ))}
        </div>
        <p className="hint">Prices fetched {ago(r.fetchedAt)}. Cardmarket = official daily price guide for the Japanese printing.</p>
      </section>

      {viewer != null && (
        <div className="viewer" onClick={() => setViewer(null)} role="dialog" aria-label="Photos">
          <div className="viewer-strip" ref={(el) => el?.children[viewer]?.scrollIntoView({ inline: 'center' })}>
            {images.map((src) => (
              <img key={src} src={src.replace('/low.webp', '/high.webp')} alt="" />
            ))}
          </div>
          <div className="viewer-hint">Swipe for more · tap to close</div>
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

function Unavailable({ label, res }: { label: string; res: { ok: false; error: string; url?: string } }) {
  return <Row label={label} value="–" sub={res.error} href={res.url} />;
}

function PriceTables({ r }: { r: CardReport }) {
  const eur = (jpy: number | null | undefined) => (jpy ? `≈ ${fmtEur(jpy * r.fx.jpyToEur)}` : undefined);
  const cm = r.cardmarket;
  return (
    <>
      <section className="panel">
        <h2>🇩🇪 Cardmarket (sell)</h2>
        {cm.ok ? (
          <>
            <Row label="Price trend" value={fmtEur(cm.trend)} href={cm.url} />
            <Row label="30-day average" value={fmtEur(cm.avg30)} />
            <Row label="7-day average" value={fmtEur(cm.avg7)} />
            <Row label="1-day average" value={fmtEur(cm.avg1)} />
            <Row label="Lowest offer" value={fmtEur(cm.low)} />
            {cm.matched === 'name' && <p className="hint">Product matched by set position. Check the listing before selling.</p>}
          </>
        ) : (
          <Unavailable label="Cardmarket" res={cm} />
        )}
      </section>
      <section className="panel">
        <h2>🇯🇵 Japan (buy)</h2>
        {r.yuyutei.ok ? (
          <Row
            label="Yuyu-tei shop price"
            value={fmtJpy(r.yuyutei.priceJpy)}
            sub={`${eur(r.yuyutei.priceJpy)} · ${r.yuyutei.stock === 0 ? 'sold out' : r.yuyutei.stock != null ? `${r.yuyutei.stock} in stock` : 'stock unknown'}${r.yuyutei.asOf ? ` · daily scan ${ago(r.yuyutei.asOf)}` : ''}`}
            href={r.yuyutei.url}
          />
        ) : (
          <Unavailable label="Yuyu-tei" res={r.yuyutei} />
        )}
        {r.snkrdunk.ok ? (
          <>
            <Row label="SNKRDUNK lowest ask" value={fmtJpy(r.snkrdunk.lowestAskJpy)} sub={`${eur(r.snkrdunk.lowestAskJpy) ?? ''} · ${r.snkrdunk.listingCount ?? '?'} listings`} href={r.snkrdunk.url} />
            <Row label="SNKRDUNK sold (A, 1-month median)" value={fmtJpy(r.snkrdunk.rawMedianJpy)} sub={eur(r.snkrdunk.rawMedianJpy)} />
          </>
        ) : (
          <Unavailable label="SNKRDUNK" res={r.snkrdunk} />
        )}
        {r.mercari.ok ? (
          <>
            <Row label="Mercari sold (median)" value={fmtJpy(r.mercari.soldMedianJpy)} sub={`${eur(r.mercari.soldMedianJpy) ?? ''} · ${r.mercari.soldCount} sold`} href={r.mercari.url} />
            <Row label="Mercari lowest listing" value={fmtJpy(r.mercari.activeLowestJpy)} sub={eur(r.mercari.activeLowestJpy)} />
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
    const out: Series[] = [{ label: mode === 'raw' ? 'SNKRDUNK sold (A)' : 'SNKRDUNK sold PSA10', points: jpy(snk.data ?? []), color: COLORS.snk }];
    if (mode === 'raw') {
      const rows = hist.data?.[r.card.id] ?? [];
      const at = (d: string) => Date.parse(d);
      out.push({ label: 'Cardmarket trend', points: inRange(rows.filter((x) => x[1] != null).map((x) => ({ t: at(x[0]), v: x[1]! }))), color: COLORS.cm });
      out.push({ label: 'Yuyu-tei', points: inRange(rows.filter((x) => x[3] != null).map((x) => ({ t: at(x[0]), v: x[3]! * r.fx.jpyToEur }))), color: COLORS.yyt, stepped: true });
      // Current Cardmarket levels as reference lines across the visible range.
      if (r.cardmarket.ok && r.cardmarket.trend) {
        const start = Math.max(from, (snk.data?.[0]?.t ?? Date.now() - 30 * 86400_000));
        out.push({ label: 'Cardmarket trend now', points: [{ t: start, v: r.cardmarket.trend }, { t: Date.now(), v: r.cardmarket.trend }], color: COLORS.cmAvg, dashed: true });
      }
    } else if (pc.data) {
      const usd = (p: ChartPoint[]) => p.map((x) => ({ t: x.t, v: x.v * r.fx.usdToEur }));
      out.push({ label: 'PriceCharting PSA10 (eBay)', points: inRange(usd(pc.data.psa10)), color: COLORS.pc });
    }
    return out;
  }, [snk.data, hist.data, pc.data, mode, range, r]);

  return (
    <section className="panel">
      <h2>Price history</h2>
      <div className="row-scroll">
        <Chips value={mode} onChange={setMode} options={[['raw', 'Raw'], ['psa10', 'PSA 10']]} />
        <Chips<Range> value={range} onChange={setRange} options={[['oneWeek', '1W'], ['oneMonth', '1M'], ['threeMonths', '3M'], ['all', 'All']]} />
      </div>
      {snk.loading && !snk.data ? <Spinner /> : <PriceChart series={series} />}
      <p className="hint">All values in EUR at today’s ECB rate. Cardmarket and Yuyu-tei history builds up from the daily scan.</p>
    </section>
  );
}

function RecentSales({ r }: { r: CardReport }) {
  const [tab, setTab] = useState<'snk' | 'mercari'>('snk');
  const trades = r.snkrdunk.ok ? r.snkrdunk.trades : [];
  const mercari = r.mercari.ok ? r.mercari.items : [];
  return (
    <section className="panel">
      <h2>Last sales in Japan</h2>
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
          {!trades.length && <li className="muted">No recent trades{!r.snkrdunk.ok ? ` (${r.snkrdunk.error})` : ''}.</li>}
        </ul>
      )}
      {tab === 'mercari' && (
        <ul className="sales">
          {mercari.map((m) => (
            <li key={m.id}>
              <a href={m.url} target="_blank" rel="noreferrer" className="mercari-item">
                {m.thumb && <img src={m.thumb} alt="" loading="lazy" />}
                <span className="m-name">{m.name}</span>
                <span className={m.sold ? 'badge small' : 'badge small live'}>{m.sold ? 'sold' : 'for sale'}</span>
                <strong>{fmtJpy(m.priceJpy)}</strong>
              </a>
            </li>
          ))}
          {!mercari.length && <li className="muted">No matching listings{!r.mercari.ok ? ` (${r.mercari.error})` : ''}.</li>}
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
      <h2>Graded (PSA)</h2>
      <Row label="🇯🇵 SNKRDUNK PSA10 sold" value={fmtJpy(s?.psa10MedianJpy)} sub={jp10 ? `≈ ${fmtEur(jp10)}` : undefined} />
      <Row label="🇯🇵 SNKRDUNK PSA9 sold" value={fmtJpy(s?.psa9MedianJpy)} sub={s?.psa9MedianJpy ? `≈ ${fmtEur(s.psa9MedianJpy * r.fx.jpyToEur)}` : undefined} />
      {p && (
        <>
          <Row label="🌍 PSA10 (eBay, PriceCharting)" value={fmtUsd(p.psa10Usd)} sub={intl10 ? `≈ ${fmtEur(intl10)}` : undefined} href={p.url} />
          <Row label="🌍 Grade 9" value={fmtUsd(p.grade9Usd)} sub={p.grade9Usd ? `≈ ${fmtEur(p.grade9Usd * r.fx.usdToEur)}` : undefined} />
          <Row label="🌍 Ungraded" value={fmtUsd(p.ungradedUsd)} sub={p.ungradedUsd ? `≈ ${fmtEur(p.ungradedUsd * r.fx.usdToEur)}` : undefined} />
        </>
      )}
      {jp10 && intl10 && (
        <div className={`margin-result ${marginClass(intl10 - jp10)}`}>
          <span>PSA10 spread</span>
          <strong>{fmtSigned(intl10 - jp10)}</strong>
          <span>{fmtPct((intl10 - jp10) / jp10)}</span>
        </div>
      )}
      <p className="hint">Cardmarket has no graded price guide, so eBay sales (PriceCharting) are the international reference.</p>
    </section>
  );
}
