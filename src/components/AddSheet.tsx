import { useState } from 'react';
import type { CardSummary } from '../../lib/types';
import { fmtEur } from '../format';
import { CONDITIONS, useCollection, type Condition } from '../state';
import { Thumb } from './ui';

/** Bottom sheet: add a card to the collection with quantity, condition and optional cost. */
export function AddSheet({
  card,
  priceEur,
  photo,
  onClose,
  onAdded,
}: {
  card: CardSummary;
  priceEur?: number | null;
  photo?: string | null;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const { add } = useCollection();
  const [qty, setQty] = useState(1);
  const [condition, setCondition] = useState<Condition>('NM');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState<'JPY' | 'EUR'>('JPY');

  const submit = () => {
    const amount = Number(cost.replace(',', '.'));
    add({
      cardId: card.id,
      nameJa: card.nameJa,
      nameEn: card.nameEn,
      setId: card.setId,
      setName: card.setName,
      number: card.number,
      rarity: card.rarity,
      image: card.image,
      photo: card.externalImage ?? null, // never the scanned photo itself (too large to store)
      kind: card.id.startsWith('cm-') ? 'sealed' : 'card',
      qty,
      condition,
      cost: cost && amount > 0 ? { amount, currency } : null,
    });
    onAdded?.();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Zur Sammlung hinzufügen">
        <div className="sheet-grip" />
        <div className="sheet-card">
          <Thumb id={card.id} image={card.image} fallback={card.externalImage ?? photo} alt={card.nameJa} />
          <div>
            <div className="deal-name">{card.nameEn ?? card.nameJa}</div>
            <div className="deal-meta">
              {card.nameEn && `${card.nameJa} · `}
              {card.setId} {card.number}
            </div>
            {priceEur != null && <div className="sheet-price">{fmtEur(priceEur)} <small>Cardmarket</small></div>}
          </div>
        </div>

        <label className="field">
          Anzahl
          <div className="stepper">
            <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Weniger">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty(qty + 1)} aria-label="Mehr">+</button>
          </div>
        </label>
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
        <label className="field">
          Einkaufspreis / Stück
          <div className="cost-input">
            <input className="input" inputMode="decimal" placeholder="optional" value={cost} onChange={(e) => setCost(e.target.value)} />
            <button className="chip on" onClick={() => setCurrency(currency === 'JPY' ? 'EUR' : 'JPY')}>
              {currency === 'JPY' ? '¥' : '€'}
            </button>
          </div>
        </label>
        <button className="primary-btn" onClick={submit}>
          Zur Sammlung hinzufügen
        </button>
      </div>
    </div>
  );
}
