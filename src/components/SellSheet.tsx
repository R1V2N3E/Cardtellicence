import { useState } from 'react';
import { fmtEur, fmtSigned, marginClass } from '../format';
import { readList, write, type CollectionItem } from '../state';
import { addSale, boughtAt, daysUntil, FREIGRENZE_EUR, readSales, taxFreeFrom, yearTax } from '../tax';
import { Thumb } from './ui';

const CHANNELS = ['Cardmarket', 'eBay', 'Kleinanzeigen', 'Card Rush Ankauf', 'Privat / Messe', 'Sonstiges'];

/** Record a sale of a collection item: leaves the collection, goes into the tax overview. */
export function SellSheet({ item, valueEur, fx, onClose }: { item: CollectionItem; valueEur: number | null; fx: number | null; onClose: () => void }) {
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(valueEur ? String(Math.round(valueEur * 100) / 100).replace('.', ',') : '');
  const [fees, setFees] = useState('');
  const [channel, setChannel] = useState(CHANNELS[0]);
  const [bought, setBought] = useState(boughtAt(item));
  const today = new Date().toISOString().slice(0, 10);

  const p = Number(price.replace(',', '.')) || 0;
  const f = Number(fees.replace(',', '.')) || 0;
  const costEach = item.cost ? (item.cost.currency === 'EUR' ? item.cost.amount : fx ? item.cost.amount * fx : null) : null;
  const gain = costEach != null ? qty * (p - costEach) - f : null;
  const free = taxFreeFrom(bought);
  const taxFree = today >= free;
  const yt = yearTax(readSales());
  const after = !taxFree && gain != null ? yt.taxableGain + gain : null;

  const save = () => {
    if (!p) return;
    addSale({
      cardId: item.cardId,
      name: item.nameEn ?? item.nameJa,
      setId: item.setId,
      qty,
      priceEur: p,
      feesEur: f,
      channel,
      soldAt: new Date().toISOString(),
      boughtAt: bought,
      costEur: costEach,
    });
    const cur = readList<CollectionItem>('ct-collection');
    write('ct-collection', qty >= item.qty ? cur.filter((c) => c.uid !== item.uid) : cur.map((c) => (c.uid === item.uid ? { ...c, qty: c.qty - qty, boughtAt: bought } : c)));
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Verkauf eintragen">
        <div className="sheet-grip" />
        <div className="sheet-card">
          <Thumb id={item.cardId} image={item.image} fallback={item.photo} alt={item.nameJa} zoom={false} />
          <div>
            <div className="deal-name">Verkauf: {item.nameEn ?? item.nameJa}</div>
            <div className="deal-meta">
              {item.setId} {item.number} · {item.qty} im Besitz
            </div>
            {valueEur != null && <div className="sheet-price">{fmtEur(valueEur)} <small>aktueller Wert</small></div>}
          </div>
        </div>
        {item.qty > 1 && (
          <label className="field">
            Anzahl
            <div className="stepper">
              <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
              <span>{qty}</span>
              <button onClick={() => setQty(Math.min(item.qty, qty + 1))}>+</button>
            </div>
          </label>
        )}
        <label className="field">
          Verkaufspreis / Stück (€)
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">
          Gebühren + Versand gesamt (€)
          <input className="input" inputMode="decimal" placeholder="0" value={fees} onChange={(e) => setFees(e.target.value)} />
        </label>
        <label className="field">
          Verkauft über
          <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Gekauft am
          <input className="input date-input" type="date" max={today} value={bought} onChange={(e) => setBought(e.target.value)} />
        </label>

        <div className={`tax-hint ${taxFree ? 'ok' : after != null && after >= FREIGRENZE_EUR ? 'bad' : 'warn'}`}>
          {gain != null ? (
            <div className="row">
              <span className="row-label">Gewinn</span>
              <span className={`row-value ${marginClass(gain)}`}>{fmtSigned(gain)}</span>
            </div>
          ) : (
            <p>Ohne Einkaufspreis lässt sich der Gewinn nicht berechnen.</p>
          )}
          {taxFree ? (
            <p>✓ Länger als ein Jahr gehalten – der Gewinn ist steuerfrei.</p>
          ) : (
            <p>
              Innerhalb der Haltefrist (steuerfrei ab {new Date(free).toLocaleDateString('de-DE')}, noch {daysUntil(free)} Tage).
              {after != null &&
                (after >= FREIGRENZE_EUR
                  ? ` Damit kämen deine steuerpflichtigen Gewinne ${yt.year} auf ${fmtEur(after)} – über der Freigrenze von ${fmtEur(FREIGRENZE_EUR)}: dann ist der gesamte Gewinn zu versteuern.`
                  : ` Steuerpflichtige Gewinne ${yt.year} danach: ${fmtEur(after)} von ${fmtEur(FREIGRENZE_EUR)} Freigrenze.`)}
            </p>
          )}
        </div>
        <button className="primary-btn" onClick={save} disabled={!p}>
          Verkauf eintragen
        </button>
      </div>
    </div>
  );
}
