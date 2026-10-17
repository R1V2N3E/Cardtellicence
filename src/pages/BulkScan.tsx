import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CardSummary, Opportunity } from '../../lib/types';
import type { BulkCard, BulkReading } from '../../lib/vision';
import { api, loadOpportunities } from '../api';
import { Thumb } from '../components/ui';
import { fmtEur } from '../format';
import { addCollectionItem, CONDITIONS, type Condition } from '../state';
import { fileToJpeg, PhotoButtons, Working } from './VisionScan';

type Status = 'ok' | 'unsure' | 'none';
interface Row {
  idx: number;
  c: BulkCard;
  card: CardSummary | null;
  price: number | null;
  status: Status;
  selected: boolean;
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s・･\-_]/g, '');
const numPart = (n: string | null | undefined) => n?.split('/')[0].replace(/^0+/, '') ?? '';
const toSummary = (o: Opportunity): CardSummary => ({
  id: o.id,
  setId: o.setId,
  setName: o.setName,
  localId: numPart(o.number),
  number: o.number,
  nameJa: o.nameJa,
  nameEn: o.nameEn,
  rarity: o.rarity,
  image: o.image,
});

/** Find the card a reading stands for: daily scan first, then the full card search. */
async function matchCard(c: BulkCard, catalog: Opportunity[]): Promise<{ card: CardSummary | null; status: Status }> {
  const set = c.set_code?.toLowerCase();
  const num = numPart(c.number);
  const sure: Status = c.confidence === 'low' ? 'unsure' : 'ok';
  if (set && num) {
    const hit = catalog.find((o) => o.setId.toLowerCase() === set && numPart(o.number) === num);
    if (hit) return { card: toSummary(hit), status: sure };
    const found = await api.search(`${c.set_code} ${num}`).catch(() => []);
    const exact = found.find((r) => r.setId.toLowerCase() === set && numPart(r.number) === num);
    if (exact) return { card: exact, status: sure };
  }
  const name = c.name ?? c.name_en;
  if (name) {
    const byName = catalog.filter((o) => norm(o.nameJa) === norm(name) || (o.nameEn && norm(o.nameEn) === norm(name)));
    const withNum = num ? byName.filter((o) => numPart(o.number) === num) : byName;
    if (withNum.length === 1) return { card: toSummary(withNum[0]), status: 'unsure' };
    const found = await api.search(name).catch(() => []);
    const cands = num ? found.filter((r) => numPart(r.number) === num) : found;
    if (cands.length) return { card: cands[0], status: 'unsure' };
  }
  return { card: null, status: 'none' };
}

/** Run promises a few at a time. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export function BulkMode() {
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState<BulkReading | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Opportunity[]>([]);
  const [condition, setCondition] = useState<Condition>('NM');
  const today = new Date().toISOString().slice(0, 10);
  const [bought, setBought] = useState(today);
  const [assign, setAssign] = useState<Row | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  useEffect(() => {
    loadOpportunities()
      .then((d) => setCatalog(d.items))
      .catch(() => {});
  }, []);

  const run = async (f: File) => {
    setError(null);
    setReading(null);
    setRows([]);
    setAdded(null);
    const img = await fileToJpeg(f, 2000);
    setPhoto(img);
    setBusy(true);
    try {
      const r = await api.vision<BulkReading>('bulk', [img]);
      const cat = catalog.length ? catalog : await loadOpportunities().then((d) => d.items).catch(() => []);
      const matches = await pool(r.cards, 4, (c) => matchCard(c, cat));
      const prices = new Map(cat.map((o) => [o.id, o.cmTrend]));
      setRows(r.cards.map((c, i) => ({ idx: i + 1, c, ...matches[i], price: matches[i].card ? (prices.get(matches[i].card!.id) ?? null) : null, selected: !!matches[i].card })));
      setReading(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (idx: number) => setRows((rs) => rs.map((r) => (r.idx === idx ? { ...r, selected: !r.selected && !!r.card } : r)));
  const chosen = rows.filter((r) => r.selected && r.card);
  const value = chosen.reduce((s, r) => s + (r.price ?? 0), 0);
  const counts = useMemo(() => ({ ok: rows.filter((r) => r.status === 'ok').length, unsure: rows.filter((r) => r.status === 'unsure').length, none: rows.filter((r) => r.status === 'none').length }), [rows]);

  const addAll = () => {
    // The same card several times on the page → one entry with that quantity.
    const byId = new Map<string, { card: CardSummary; qty: number }>();
    for (const r of chosen) {
      const e = byId.get(r.card!.id);
      byId.set(r.card!.id, { card: r.card!, qty: (e?.qty ?? 0) + 1 });
    }
    for (const { card, qty } of byId.values())
      addCollectionItem({
        cardId: card.id,
        nameJa: card.nameJa,
        nameEn: card.nameEn,
        setId: card.setId,
        setName: card.setName,
        number: card.number,
        rarity: card.rarity,
        image: card.image,
        photo: card.externalImage ?? null,
        kind: 'card',
        qty,
        condition,
        cost: null,
        boughtAt: bought || today,
      });
    setAdded(chosen.length);
  };

  if (added != null)
    return (
      <div className="vs-intro">
        <div className="vs-intro-icon">✅</div>
        <h2>{added} Karten hinzugefügt</h2>
        <p>Anzahl, Zustand und Einkaufspreis kannst du im Portfolio jederzeit über ✎ anpassen.</p>
        <div className="vs-buttons">
          <button className="primary-btn" onClick={() => navigate('/portfolio')}>
            Zum Portfolio
          </button>
          <PhotoButtons onFile={run} label="Nächstes Foto" />
        </div>
      </div>
    );

  if (!photo)
    return (
      <div className="vs-intro">
        <div className="vs-intro-icon">🗂️</div>
        <h2>Mehrere Karten auf einmal</h2>
        <p>Fotografiere eine Binder-Seite oder ausgelegte Karten. Die KI erkennt jede Karte, du prüfst die Liste – und alle landen mit einem Tipp in deiner Sammlung.</p>
        <ul className="vs-tips">
          <li>Bis zu 40 Karten pro Foto, z. B. eine 9er-Binder-Seite</li>
          <li>Set-Code und Nummer unten links sollten lesbar sein</li>
          <li>Spiegelungen auf Hüllen vermeiden – leicht schräges Licht hilft</li>
        </ul>
        <PhotoButtons onFile={run} label="Karten fotografieren" />
      </div>
    );

  if (busy) return <Working photo={photo} steps={['Suche Karten im Bild …', 'Lese Set-Codes und Nummern …', 'Gleiche mit der Kartendatenbank ab …', 'Hole Preise …']} />;

  return (
    <div className="vs-result bulk">
      <div className="vs-photo">
        <img src={photo} alt="Foto" />
        {rows.map((r) => (
          <button
            key={r.idx}
            className={`vs-box ${r.status === 'ok' ? 'buy' : r.status === 'unsure' ? 'maybe' : 'unknown'} ${r.selected ? '' : 'off'}`}
            style={{ left: `${r.c.box.x * 100}%`, top: `${r.c.box.y * 100}%`, width: `${r.c.box.w * 100}%`, height: `${r.c.box.h * 100}%` }}
            onClick={() => document.getElementById(`bk-row-${r.idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
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
            <b>{rows.length} Karten erkannt</b>
            <span>
              {counts.ok > 0 && <span className="vs-pill buy">✓ sicher {counts.ok}</span>}
              {counts.unsure > 0 && <span className="vs-pill maybe">~ prüfen {counts.unsure}</span>}
              {counts.none > 0 && <span className="vs-pill unknown">? nicht gefunden {counts.none}</span>}
            </span>
            {reading.note && <small>{reading.note}</small>}
          </div>
          <ul className="list vs-list">
            {rows.map((r) => (
              <li key={r.idx} id={`bk-row-${r.idx}`}>
                <div className={`vs-row bk-row ${r.selected ? '' : 'off'}`}>
                  <button className={`bk-check ${r.selected ? 'on' : ''}`} onClick={() => (r.card ? toggle(r.idx) : setAssign(r))} aria-label={r.selected ? 'Abwählen' : 'Auswählen'}>
                    {r.selected ? '✓' : ''}
                  </button>
                  <span className={`vs-num ${r.status === 'ok' ? 'buy' : r.status === 'unsure' ? 'maybe' : 'unknown'}`}>{r.idx}</span>
                  {r.card ? <Thumb id={r.card.id} image={r.card.image} fallback={r.card.externalImage} alt={r.card.nameJa} /> : <span className="thumb ph">?</span>}
                  <div className="deal-main">
                    <div className="deal-name">{r.card ? (r.card.nameEn ?? r.card.nameJa) : (r.c.name_en ?? r.c.name ?? 'Nicht erkannt')}</div>
                    <div className="deal-meta">
                      {r.card ? `${r.card.setId} ${r.card.number}` : [r.c.set_code, r.c.number].filter(Boolean).join(' ') || 'Set/Nummer unleserlich'}
                      {r.status === 'unsure' ? ' · bitte prüfen' : ''}
                    </div>
                    {r.price != null && <div className="deal-prices">🇩🇪 {fmtEur(r.price)}</div>}
                  </div>
                  <button className="link-btn" onClick={() => setAssign(r)}>
                    {r.card ? 'Ändern' : 'Zuordnen'}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="bk-footer">
            <div className="bk-options">
              <label>
                Zustand
                <select className="select" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
                  {CONDITIONS.filter(([v]) => !v.startsWith('PSA')).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Gekauft am
                <input className="input date-input" type="date" max={today} value={bought} onChange={(e) => setBought(e.target.value)} />
              </label>
            </div>
            <button className="primary-btn bk-add" disabled={!chosen.length} onClick={addAll}>
              {chosen.length} {chosen.length === 1 ? 'Karte' : 'Karten'} hinzufügen{value > 0 ? ` · ≈ ${fmtEur(value)}` : ''}
            </button>
          </div>
          <div className="bk-more">
            <PhotoButtons onFile={run} label="Neues Foto" quiet />
          </div>
        </>
      )}
      {assign && (
        <AssignSheet
          row={assign}
          onClose={() => setAssign(null)}
          onPick={(card) => {
            const price = catalog.find((o) => o.id === card.id)?.cmTrend ?? null;
            setRows((rs) => rs.map((r) => (r.idx === assign.idx ? { ...r, card, price, status: 'ok', selected: true } : r)));
            setAssign(null);
          }}
        />
      )}
    </div>
  );
}

/** Pick the right card by hand: search by name, set code or number. */
function AssignSheet({ row, onClose, onPick }: { row: Row; onClose: () => void; onPick: (c: CardSummary) => void }) {
  const [q, setQ] = useState(() => (row.c.set_code && row.c.number ? `${row.c.set_code} ${numPart(row.c.number)}` : (row.c.name ?? row.c.name_en ?? '')));
  const [results, setResults] = useState<CardSummary[] | null>(null);
  useEffect(() => {
    if (!q.trim()) return setResults(null);
    let alive = true;
    const t = setTimeout(() => api.search(q).then((r) => alive && setResults(r), () => alive && setResults([])), 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Karte zuordnen">
        <div className="sheet-grip" />
        <div className="deal-name">Karte {row.idx} zuordnen</div>
        <p className="hint">
          Gelesen: {[row.c.name, row.c.set_code, row.c.number].filter(Boolean).join(' · ') || 'nichts Lesbares'}
        </p>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Set + Nummer (SV2a 201) …" autoFocus />
        <div className="match-alts wrap bk-results">
          {results?.slice(0, 24).map((c) => (
            <button key={c.id} className="alt" onClick={() => onPick(c)}>
              <Thumb id={c.id} image={c.image} fallback={c.externalImage} alt={c.nameJa} zoom={false} />
              <span>
                {c.setId} {c.number}
              </span>
            </button>
          ))}
          {results && !results.length && <p className="hint">Keine Karte gefunden.</p>}
        </div>
      </div>
    </div>
  );
}
