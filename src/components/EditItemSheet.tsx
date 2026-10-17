import { useState } from 'react';
import { fmtEur } from '../format';
import { CONDITIONS, readList, write, type CollectionItem, type Condition } from '../state';
import { boughtAt } from '../tax';
import { Thumb } from './ui';

/** Edit one collection entry afterwards: quantity, condition, purchase price and date — or delete it. */
export function EditItemSheet({ item, valueEur, onClose, onSell }: { item: CollectionItem; valueEur: number | null; onClose: () => void; onSell?: () => void }) {
  const sealed = item.kind === 'sealed' || item.cardId.startsWith('cm-');
  const [qty, setQty] = useState(item.qty);
  const [condition, setCondition] = useState<Condition>(item.condition);
  const [cost, setCost] = useState(item.cost ? String(item.cost.amount).replace('.', ',') : '');
  const [currency, setCurrency] = useState<'JPY' | 'EUR'>(item.cost?.currency ?? 'JPY');
  const [bought, setBought] = useState(boughtAt(item));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const save = () => {
    const amount = Number(cost.replace(/\./g, '').replace(',', '.'));
    const patch: Partial<CollectionItem> = {
      qty,
      condition,
      cost: cost.trim() && amount > 0 ? { amount, currency } : null,
      boughtAt: bought || boughtAt(item),
    };
    write('ct-collection', readList<CollectionItem>('ct-collection').map((c) => (c.uid === item.uid ? { ...c, ...patch } : c)));
    onClose();
  };

  const remove = () => {
    write('ct-collection', readList<CollectionItem>('ct-collection').filter((c) => c.uid !== item.uid));
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Eintrag bearbeiten">
        <div className="sheet-grip" />
        <div className="sheet-card">
          <Thumb id={item.cardId} image={item.image} fallback={item.photo} alt={item.nameJa} zoom={false} />
          <div>
            <div className="deal-name">{item.nameEn ?? item.nameJa}</div>
            <div className="deal-meta">
              {item.setId} {item.number}
            </div>
            {valueEur != null && (
              <div className="sheet-price">
                {fmtEur(valueEur * qty)} <small>{qty > 1 ? `${qty} × ${fmtEur(valueEur)}` : 'aktueller Wert'}</small>
              </div>
            )}
          </div>
        </div>

        <label className="field">
          Anzahl
          <div className="stepper">
            <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Weniger">
              −
            </button>
            <input
              className="stepper-input"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(9999, Number(e.target.value.replace(/\D/g, '')) || 1)))}
              aria-label="Anzahl"
            />
            <button onClick={() => setQty(qty + 1)} aria-label="Mehr">
              +
            </button>
          </div>
        </label>
        {!sealed && (
          <label className="field">
            Zustand
            <select className="select" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
              {CONDITIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Einkaufspreis / Stück
          <div className="cost-input">
            <input className="input" inputMode="decimal" placeholder="optional" value={cost} onChange={(e) => setCost(e.target.value)} />
            <button className="chip on" onClick={() => setCurrency(currency === 'JPY' ? 'EUR' : 'JPY')}>
              {currency === 'JPY' ? '¥' : '€'}
            </button>
          </div>
        </label>
        <label className="field">
          Gekauft am
          <input className="input date-input" type="date" max={today} value={bought} onChange={(e) => setBought(e.target.value)} />
        </label>

        <button className="primary-btn" onClick={save}>
          Speichern
        </button>
        <div className="edit-actions">
          {onSell && (
            <button className="ghost-btn" onClick={onSell}>
              💶 Verkauf eintragen
            </button>
          )}
          {confirmDelete ? (
            <button className="ghost-btn danger-btn" onClick={remove}>
              Wirklich löschen?
            </button>
          ) : (
            <button className="ghost-btn danger-btn" onClick={() => setConfirmDelete(true)}>
              🗑 Eintrag löschen
            </button>
          )}
        </div>
        <p className="hint">„Löschen“ entfernt den Eintrag ohne Verkauf. Wenn du verkauft hast, nimm „Verkauf eintragen“ – dann zählt der Gewinn für die Steuer-Übersicht.</p>
      </div>
    </div>
  );
}
