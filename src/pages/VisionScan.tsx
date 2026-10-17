import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CardReport, Opportunity } from '../../lib/types';
import type { Centering, ConditionReading, ShopCard, ShopReading } from '../../lib/vision';
import { api, loadOpportunities } from '../api';
import { ScanModes } from '../components/ScanModes';
import { BulkMode } from './BulkScan';
import { Thumb } from '../components/ui';
import { fmtEur, fmtJpy, fmtSigned } from '../format';
import { computeMargin, costModel, sellPrice, type Margin } from '../margin';
import { readSettings } from '../state';

type Mode = 'shop' | 'bulk' | 'condition';

/** Downscale an image file to a JPEG data URL. */
export function fileToJpeg(file: File, maxEdge: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('Foto konnte nicht gelesen werden'));
    img.src = url;
  });
}

export function PhotoButtons({ onFile, label, quiet = false }: { onFile: (f: File) => void; label: string; quiet?: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const pick = (f?: File) => f && onFile(f);
  return (
    <div className="vs-buttons">
      <button className={quiet ? 'ghost-btn' : 'primary-btn'} onClick={() => cam.current?.click()}>
        📷 {label}
      </button>
      <button className="ghost-btn" onClick={() => lib.current?.click()}>
        Aus Fotos wählen
      </button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}

export function Working({ photo, steps }: { photo: string; steps: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(steps.length - 1, n + 1)), 2600);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="vs-working">
      <div className="vs-photo scanning">
        <img src={photo} alt="" />
        <span className="vs-sweep" />
        <span className="vs-grid" />
      </div>
      <div className="ai-status center">
        <span className="ai-orb small" />
        <span>{steps[i]}</span>
      </div>
    </div>
  );
}

export function VisionScan({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  return (
    <div className="vs">
      <header className="vs-top">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Zurück">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <ScanModes mode={mode} />
        <span style={{ width: 44 }} />
      </header>
      {mode === 'shop' ? <ShopMode key="shop" /> : mode === 'bulk' ? <BulkMode key="bulk" /> : <ConditionMode key="condition" />}
    </div>
  );
}

// ======================= Shop mode =======================

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s・･\-_]/g, '');
const numPart = (n: string | null | undefined) => n?.split('/')[0].replace(/^0+/, '') ?? '';

function matchShop(c: ShopCard, items: Opportunity[]): Opportunity | null {
  const set = c.set_code?.toLowerCase();
  if (set && c.number) {
    const hit = items.find((o) => o.setId.toLowerCase() === set && numPart(o.number) === numPart(c.number));
    if (hit) return hit;
  }
  if (!c.name && !c.name_en) return null;
  let cands = items.filter((o) => (c.name && norm(o.nameJa) === norm(c.name)) || (c.name_en && o.nameEn && norm(o.nameEn) === norm(c.name_en)));
  if (c.number) cands = cands.filter((o) => numPart(o.number) === numPart(c.number)).length ? cands.filter((o) => numPart(o.number) === numPart(c.number)) : cands;
  if (c.rarity) cands = cands.filter((o) => o.rarity?.toUpperCase() === c.rarity!.toUpperCase()).length ? cands.filter((o) => o.rarity?.toUpperCase() === c.rarity!.toUpperCase()) : cands;
  if (!cands.length) return null;
  // Several printings: the one whose Card Rush price is closest to the tag.
  if (c.price_jpy) cands.sort((a, b) => Math.abs((a.crJpy ?? 1e9) - c.price_jpy!) - Math.abs((b.crJpy ?? 1e9) - c.price_jpy!));
  return cands[0];
}

type Verdict = 'buy' | 'maybe' | 'skip' | 'unknown';
const VERDICT: Record<Verdict, string> = { buy: '✓ Kaufen', maybe: '~ Knapp', skip: '✗ Zu teuer', unknown: '? Prüfen' };

interface ShopRow {
  idx: number;
  c: ShopCard;
  o: Opportunity | null;
  m: Margin | null;
  verdict: Verdict;
}

function ShopMode() {
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState<ShopReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Opportunity[]>([]);
  const [fx, setFx] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    loadOpportunities()
      .then((d) => (setItems(d.items), setFx(d.fx.jpyToEur)))
      .catch(() => {});
  }, []);

  const run = async (f: File) => {
    setError(null);
    setReading(null);
    setSel(null);
    const img = await fileToJpeg(f, 2000);
    setPhoto(img);
    setBusy(true);
    try {
      setReading(await api.vision<ShopReading>('shop', [img]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo((): ShopRow[] => {
    if (!reading || !fx) return [];
    const s = readSettings();
    return reading.cards
      .map((c, idx) => {
        const o = matchShop(c, items);
        const sell = o ? sellPrice({ trend: o.cmTrend, avg30: o.cmAvg30, avg7: o.cmAvg7, low: o.cmLow }, s.sellRef).eur : null;
        const m = o && c.price_jpy && !c.graded ? computeMargin({ source: 'cardrush', label: 'Ladenpreis', jpy: c.price_jpy }, sell, fx, costModel(s)) : null;
        const verdict: Verdict =
          !m || m.marginEur == null ? 'unknown' : m.marginEur >= 5 && (m.roi ?? 0) >= 0.15 ? 'buy' : m.marginEur > 0 ? 'maybe' : 'skip';
        return { idx: idx + 1, c, o, m, verdict };
      })
      .sort((a, b) => (b.m?.marginEur ?? -1e9) - (a.m?.marginEur ?? -1e9));
  }, [reading, items, fx]);

  const askAi = () => {
    const lines = rows.map((r) => `${r.idx}. ${r.c.name ?? r.c.name_en ?? '?'} ${r.c.set_code ?? ''} ${r.c.number ?? ''} – Schild ${r.c.price_jpy ? `¥${r.c.price_jpy}` : '?'}${r.o ? ` (erkannt als ${r.o.id})` : ''}${r.c.graded ? ` [${r.c.graded}]` : ''}`);
    const q = `Ich stehe in einem Laden in Japan${reading?.shop ? ` (${reading.shop})` : ''} vor dieser Vitrine:\n${lines.join('\n')}\n\nWas davon soll ich kaufen? Prüfe die Preise gegen Card Rush und Cardmarket und rechne mit meinen Kosten.`;
    navigate(`/ai?q=${encodeURIComponent(q)}`);
  };

  if (!photo)
    return (
      <div className="vs-intro">
        <div className="vs-intro-icon">🏪</div>
        <h2>Vitrine scannen</h2>
        <p>Fotografiere eine Vitrine oder Wand mit Einzelkarten und Preisschildern. Die KI liest jede Karte und ihren Preis – du siehst sofort, was sich nach allen Kosten in Deutschland lohnt.</p>
        <ul className="vs-tips">
          <li>Möglichst gerade, ohne Spiegelung auf dem Glas</li>
          <li>Preisschilder müssen lesbar sein – lieber zwei Fotos als eins zu weit weg</li>
          <li>Funktioniert mit Card Rush, Hareruya, Yuyu-tei & Co.</li>
        </ul>
        <PhotoButtons onFile={run} label="Vitrine fotografieren" />
      </div>
    );

  if (busy) return <Working photo={photo} steps={['Suche Karten im Bild …', 'Lese die Preisschilder …', 'Ordne Schilder den Karten zu …', 'Gleiche mit Card Rush & Cardmarket ab …', 'Rechne Netto-Margen …']} />;

  return (
    <div className="vs-result">
      <div className="vs-photo">
        <img src={photo} alt="Vitrine" />
        {rows.map((r) => (
          <button
            key={r.idx}
            className={`vs-box ${r.verdict} ${sel === r.idx ? 'sel' : ''}`}
            style={{ left: `${r.c.box.x * 100}%`, top: `${r.c.box.y * 100}%`, width: `${r.c.box.w * 100}%`, height: `${r.c.box.h * 100}%` }}
            onClick={() => (setSel(r.idx), document.getElementById(`vs-row-${r.idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))}
            aria-label={`Karte ${r.idx}`}
          >
            <span>{r.idx}</span>
          </button>
        ))}
      </div>
      {error && <div className="error-box">⚠︎ {error}</div>}
      {reading && (
        <>
          <div className="vs-summary">
            <b>{rows.length} Karten erkannt{reading.shop ? ` · ${reading.shop}` : ''}</b>
            <span>
              {(['buy', 'maybe', 'skip', 'unknown'] as Verdict[]).map((v) => {
                const n = rows.filter((r) => r.verdict === v).length;
                return n ? (
                  <span key={v} className={`vs-pill ${v}`}>
                    {VERDICT[v]} {n}
                  </span>
                ) : null;
              })}
            </span>
            {reading.note && <small>{reading.note}</small>}
          </div>
          <ul className="list vs-list">
            {rows.map((r) => (
              <li key={r.idx} id={`vs-row-${r.idx}`} className={sel === r.idx ? 'sel' : ''}>
                <div className="vs-row" onClick={() => r.o && navigate(`/card/${encodeURIComponent(r.o.id)}`)}>
                  <span className={`vs-num ${r.verdict}`}>{r.idx}</span>
                  {r.o ? <Thumb id={r.o.id} image={r.o.image} fallback={r.o.snkImg} alt={r.o.nameJa} zoom={false} /> : <span className="thumb ph">?</span>}
                  <div className="deal-main">
                    <div className="deal-name">{r.o ? (r.o.nameEn ?? r.o.nameJa) : (r.c.name_en ?? r.c.name ?? 'Unbekannt')}</div>
                    <div className="deal-meta">
                      {r.o ? `${r.o.setId} ${r.o.number}` : [r.c.set_code, r.c.number].filter(Boolean).join(' ') || 'nicht zugeordnet'}
                      {r.c.graded ? ` · ${r.c.graded}` : ''}
                      {r.c.confidence === 'low' ? ' · unsicher gelesen' : ''}
                    </div>
                    <div className="deal-prices">
                      <span>🏷️ {r.c.price_jpy ? fmtJpy(r.c.price_jpy) : '–'}</span>
                    </div>
                    {r.o?.crJpy ? <div className="deal-meta">Card Rush verlangt {fmtJpy(r.o.crJpy)}</div> : null}
                    <div className="deal-prices">🇩🇪 {r.o?.cmTrend != null ? fmtEur(r.o.cmTrend) : '–'}</div>
                  </div>
                  <div className={`vs-verdict ${r.verdict}`}>
                    <b>{r.m?.marginEur != null ? fmtSigned(r.m.marginEur) : VERDICT[r.verdict]}</b>
                    <small>{r.m?.roi != null ? `${Math.round(r.m.roi * 100)} % · ${VERDICT[r.verdict]}` : r.c.graded ? 'gegradet' : ''}</small>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="hint">
            Marge netto mit deinen Kosten-Einstellungen: Schildpreis + Versand, Zoll, Einfuhrumsatzsteuer gegen den Cardmarket-Verkauf abzüglich Gebühr. Gegradete Karten bewertet die
            Ampel nicht (Cardmarket-Trend gilt für Rohkarten). Schilder immer selbst gegenprüfen.
          </p>
          <div className="vs-buttons">
            <button className="primary-btn" onClick={askAi}>
              ✨ Mit der KI besprechen
            </button>
            <PhotoButtons onFile={run} label="Nächste Vitrine" />
          </div>
        </>
      )}
    </div>
  );
}

// ======================= Condition mode =======================

type Lines = { oL: number; iL: number; iR: number; oR: number; oT: number; iT: number; iB: number; oB: number };

function initialLines(box: ConditionReading['card_box'], c: Centering | null): Lines {
  const b = box ?? { x: 0.08, y: 0.06, w: 0.84, h: 0.88 };
  const cc = c ?? { left: 4, right: 4, top: 4, bottom: 4 };
  return {
    oL: b.x,
    iL: b.x + (cc.left / 100) * b.w,
    iR: b.x + b.w - (cc.right / 100) * b.w,
    oR: b.x + b.w,
    oT: b.y,
    iT: b.y + (cc.top / 100) * b.h,
    iB: b.y + b.h - (cc.bottom / 100) * b.h,
    oB: b.y + b.h,
  };
}

const ratio = (a: number, b: number) => {
  const t = a + b;
  if (t <= 0) return null;
  const big = Math.max(a, b) / t;
  return Math.round(big * 100);
};
// PSA centering limits (larger side, front / back)
const PSA_FRONT: [number, string][] = [[55, 'PSA 10'], [60, 'PSA 9'], [65, 'PSA 8'], [70, 'PSA 7']];
const PSA_BACK: [number, string][] = [[75, 'PSA 10'], [90, 'PSA 9']];
const bestFor = (worst: number | null, table: [number, string][]) => (worst == null ? '–' : (table.find(([lim]) => worst <= lim)?.[1] ?? 'unter PSA 7'));

function CenteringTool({ photo, reading }: { photo: string; reading: ConditionReading }) {
  const [l, setL] = useState<Lines>(() => initialLines(reading.card_box, reading.centering_front));
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<keyof Lines | null>(null);
  const vertical: (keyof Lines)[] = ['oL', 'iL', 'iR', 'oR'];
  const horizontal: (keyof Lines)[] = ['oT', 'iT', 'iB', 'oB'];

  const move = (e: RPointerEvent) => {
    const k = drag.current;
    const r = ref.current?.getBoundingClientRect();
    if (!k || !r) return;
    const v = vertical.includes(k) ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    setL((cur) => ({ ...cur, [k]: Math.min(1, Math.max(0, v)) }));
  };

  const lr = ratio(l.iL - l.oL, l.oR - l.iR);
  const tb = ratio(l.iT - l.oT, l.oB - l.iB);
  const worst = lr != null && tb != null ? Math.max(lr, tb) : null;
  const back = reading.centering_back;
  const backWorst = back ? Math.max(ratio(back.left, back.right) ?? 0, ratio(back.top, back.bottom) ?? 0) : null;

  return (
    <section className="panel">
      <h2>Zentrierung</h2>
      <div className="ct-stage" ref={ref} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        <img src={photo} alt="Vorderseite" draggable={false} />
        {vertical.map((k) => (
          <span key={k} className={`ct-line v ${k.startsWith('o') ? 'outer' : 'inner'}`} style={{ left: `${l[k] * 100}%` }} onPointerDown={(e) => ((drag.current = k), ref.current?.setPointerCapture(e.pointerId))} />
        ))}
        {horizontal.map((k) => (
          <span key={k} className={`ct-line h ${k.startsWith('o') ? 'outer' : 'inner'}`} style={{ top: `${l[k] * 100}%` }} onPointerDown={(e) => ((drag.current = k), ref.current?.setPointerCapture(e.pointerId))} />
        ))}
      </div>
      <div className="ct-stats">
        <div>
          <small>Links/Rechts</small>
          <b>{lr != null ? `${lr}/${100 - lr}` : '–'}</b>
        </div>
        <div>
          <small>Oben/Unten</small>
          <b>{tb != null ? `${tb}/${100 - tb}` : '–'}</b>
        </div>
        <div>
          <small>Vorderseite reicht für</small>
          <b>{bestFor(worst, PSA_FRONT)}</b>
        </div>
        {backWorst != null && (
          <div>
            <small>Rückseite (geschätzt)</small>
            <b>
              {backWorst}/{100 - backWorst} · {bestFor(backWorst, PSA_BACK)}
            </b>
          </div>
        )}
      </div>
      <p className="hint">Gestrichelt = Kartenrand, durchgezogen = Beginn des Bildrahmens. Die KI hat die Linien gesetzt – zieh sie für eine genaue Messung auf die Kanten.</p>
    </section>
  );
}

function ScoreRow({ label, part }: { label: string; part: { score: number; note: string } }) {
  return (
    <div className="cd-score">
      <div className="cd-score-top">
        <span>{label}</span>
        <b>{part.score.toFixed(1).replace('.', ',')}/10</b>
      </div>
      <div className="cd-bar">
        <i style={{ width: `${Math.max(0, Math.min(10, part.score)) * 10}%` }} />
      </div>
      <small>{part.note}</small>
    </div>
  );
}

function ConditionMode() {
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const [cardId, setCardId] = useState<string | null>(params.get('card'));
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [reading, setReading] = useState<(ConditionReading & { reference?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CardReport | null>(null);
  const [catalog, setCatalog] = useState<Opportunity[]>([]);

  useEffect(() => {
    loadOpportunities()
      .then((d) => setCatalog(d.items))
      .catch(() => {});
  }, []);

  // The card being graded: given, or recognised from what the grader read on it.
  useEffect(() => {
    if (cardId || !reading?.card.set_code || !reading.card.number) return;
    const set = reading.card.set_code.toLowerCase();
    const hit = catalog.find((o) => o.setId.toLowerCase() === set && numPart(o.number) === numPart(reading.card.number));
    if (hit) setCardId(hit.id);
  }, [reading, catalog, cardId]);

  useEffect(() => {
    if (!cardId || !reading) return;
    api.card(cardId).then(setReport, () => setReport(null));
  }, [cardId, reading]);

  const analyse = async () => {
    if (!front) return;
    setBusy(true);
    setError(null);
    try {
      setReading(await api.vision<ConditionReading & { reference?: boolean }>('condition', back ? [front, back] : [front], cardId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const card = cardId ? catalog.find((o) => o.id === cardId) : null;

  if (busy && front)
    return <Working photo={front} steps={['Vermesse die Ränder …', 'Prüfe Ecken und Kanten …', 'Suche Kratzer und Print-Lines …', 'Vergleiche mit dem Original-Scan …', 'Schätze die PSA-Note …']} />;

  if (!reading)
    return (
      <div className="vs-intro">
        <div className="vs-intro-icon">🔬</div>
        <h2>Zustand & Echtheit</h2>
        <p>Die KI begutachtet deine Karte wie ein Grader: Zentrierung, Ecken, Kanten, Oberfläche, Chance auf PSA 10 – und ob etwas auf eine Fälschung hindeutet.</p>
        {card && (
          <div className="vs-card-chip">
            <Thumb id={card.id} image={card.image} alt={card.nameJa} zoom={false} />
            <span>
              {card.nameEn ?? card.nameJa} <small>{card.setId} {card.number}</small>
            </span>
          </div>
        )}
        <ul className="vs-tips">
          <li>Karte aus der Hülle nehmen, auf dunklen, matten Untergrund legen</li>
          <li>Gerade von oben, ganze Karte im Bild, gleichmäßiges Licht ohne Spiegelung</li>
          <li>Rückseite optional – verbessert die Zentrierungs-Einschätzung</li>
        </ul>
        <div className="cd-shots">
          <ShotSlot label="Vorderseite" photo={front} onFile={async (f) => setFront(await fileToJpeg(f, 2000))} />
          <ShotSlot label="Rückseite (optional)" photo={back} onFile={async (f) => setBack(await fileToJpeg(f, 2000))} />
        </div>
        {error && <div className="error-box">⚠︎ {error}</div>}
        <button className="primary-btn" disabled={!front} onClick={analyse}>
          Begutachten
        </button>
      </div>
    );

  const g = reading.grade_chances;
  const sum = g.psa10 + g.psa9 + g.psa8 + g.lower || 1;
  const chances: [string, number][] = [
    ['PSA 10', g.psa10 / sum],
    ['PSA 9', g.psa9 / sum],
    ['PSA 8', g.psa8 / sum],
    ['≤ 7', g.lower / sum],
  ];
  const fx = report?.fx.jpyToEur ?? null;
  const raw = report?.cardmarket.ok ? report.cardmarket.trend : null;
  const snk = report?.snkrdunk.ok ? report.snkrdunk : null;
  const pc = report?.pricecharting.ok ? report.pricecharting : null;
  const p10 = snk?.psa10MedianJpy && fx ? snk.psa10MedianJpy * fx : pc?.psa10Usd && report ? pc.psa10Usd * report.fx.usdToEur : null;
  const p9 = snk?.psa9MedianJpy && fx ? snk.psa9MedianJpy * fx : pc?.grade9Usd && report ? pc.grade9Usd * report.fx.usdToEur : null;
  const fee = readSettings().gradingEur;
  const ev = raw != null && p10 != null ? (g.psa10 / sum) * p10 + (g.psa9 / sum) * (p9 ?? raw * 1.2) + ((g.psa8 + g.lower) / sum) * raw * 0.9 - fee : null;
  const auth = reading.authenticity;

  const askAi = () => {
    const q = `Ich habe meine Karte${card ? ` ${card.id} (${card.nameEn ?? card.nameJa})` : ''} begutachten lassen: Ecken ${reading.corners.score}/10, Kanten ${reading.edges.score}/10, Oberfläche ${reading.surface.score}/10, PSA-10-Chance ${Math.round((g.psa10 / sum) * 100)} %, Echtheit: ${auth.verdict}. Mängel: ${reading.defects.join('; ') || 'keine'}. Soll ich sie graden lassen oder roh verkaufen?`;
    navigate(`/ai?q=${encodeURIComponent(q)}${card ? `&ctx=${encodeURIComponent(`card:${card.id}`)}` : ''}`);
  };

  return (
    <div className="vs-result">
      {card && (
        <Link to={`/card/${encodeURIComponent(card.id)}`} className="vs-card-chip">
          <Thumb id={card.id} image={card.image} alt={card.nameJa} zoom={false} />
          <span>
            {card.nameEn ?? card.nameJa} <small>{card.setId} {card.number}</small>
          </span>
        </Link>
      )}
      <section className="panel cd-summary">
        <p>{reading.summary}</p>
        {!reading.photo_quality.ok && (
          <div className="tax-hint warn">
            <b>Foto eingeschränkt beurteilbar</b>
            <ul>
              {reading.photo_quality.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Chance auf die Note</h2>
        {chances.map(([label, p]) => (
          <div className="cd-chance" key={label}>
            <span>{label}</span>
            <div className="cd-bar">
              <i style={{ width: `${p * 100}%` }} />
            </div>
            <b>{Math.round(p * 100)} %</b>
          </div>
        ))}
        {ev != null && raw != null && (
          <div className={`tax-hint ${ev > raw ? 'ok' : 'warn'}`}>
            <b>Grading {ev > raw ? 'lohnt sich voraussichtlich' : 'lohnt sich eher nicht'}</b>
            <p>
              Erwarteter Wert nach Grading {fmtEur(ev)} (nach {fmtEur(fee)} Gebühr) gegenüber {fmtEur(raw)} roh
              {p10 != null ? ` · PSA 10 ≈ ${fmtEur(p10)}` : ''}
              {p9 != null ? ` · PSA 9 ≈ ${fmtEur(p9)}` : ''}.
            </p>
          </div>
        )}
        <p className="hint">Eine Einschätzung aus Fotos – echte Grader sehen unter Licht und Lupe mehr. Gegradete Preise aus SNKRDUNK bzw. PriceCharting.</p>
      </section>

      <CenteringTool photo={front!} reading={reading} />

      <section className="panel">
        <h2>Ecken, Kanten, Oberfläche</h2>
        <ScoreRow label="Ecken" part={reading.corners} />
        <ScoreRow label="Kanten" part={reading.edges} />
        <ScoreRow label="Oberfläche" part={reading.surface} />
        {reading.defects.length > 0 && (
          <>
            <h3 className="cd-sub">Gefundene Mängel</h3>
            <ul className="cd-defects">
              {reading.defects.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={`panel cd-auth ${auth.verdict}`}>
        <h2>{auth.verdict === 'ok' ? '✓ Keine Fälschungsmerkmale' : auth.verdict === 'check' ? '⚠︎ Genauer prüfen' : '✗ Verdacht auf Fälschung'}</h2>
        <ul>
          {auth.signals.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="hint">{reading.reference ? 'Verglichen mit dem offiziellen Scan der Karte. ' : ''}Ein Foto kann Echtheit nie beweisen – bei teuren Karten Licht-, Lupen- und Gewichtstest machen.</p>
      </section>

      <div className="vs-buttons">
        <button className="primary-btn" onClick={askAi}>
          ✨ Mit der KI besprechen
        </button>
        <button className="ghost-btn" onClick={() => (setReading(null), setFront(null), setBack(null), setReport(null))}>
          Nächste Karte
        </button>
      </div>
    </div>
  );
}

function ShotSlot({ label, photo, onFile }: { label: string; photo: string | null; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <button className={`cd-shot ${photo ? 'has' : ''}`} onClick={() => input.current?.click()}>
      {photo ? <img src={photo} alt={label} /> : <span>📷</span>}
      <small>{label}</small>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (e.target.files?.[0] && onFile(e.target.files[0]), (e.target.value = ''))} />
    </button>
  );
}

