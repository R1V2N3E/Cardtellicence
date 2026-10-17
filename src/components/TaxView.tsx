import { useNavigate } from 'react-router-dom';
import { fmtEur, fmtSigned, marginClass } from '../format';
import type { CollectionItem } from '../state';
import { boughtAt, daysUntil, FREIGRENZE_EUR, removeSale, saleGain, taxFreeFrom, useSales, yearTax } from '../tax';

/** Portfolio → Steuer: realized gains vs. the exemption limit, holding periods, recorded sales. */
export function TaxView({ items, unitValue }: { items: CollectionItem[]; unitValue: (i: CollectionItem) => number | null }) {
  const navigate = useNavigate();
  const [sales] = useSales();
  const yt = yearTax(sales);
  const today = new Date().toISOString().slice(0, 10);
  const used = Math.min(1, Math.max(0, yt.taxableGain / FREIGRENZE_EUR));
  const rows = items.map((i) => ({ i, free: taxFreeFrom(boughtAt(i)), value: (unitValue(i) ?? 0) * i.qty }));
  const soon = rows.filter((r) => r.free > today).sort((a, b) => a.free.localeCompare(b.free));
  const freeNow = rows.filter((r) => r.free <= today);
  const freeValue = freeNow.reduce((s, r) => s + r.value, 0);

  return (
    <div className="tax-view">
      <section className="panel">
        <h2>Private Verkäufe {yt.year}</h2>
        <div className="tax-big">
          <span className={marginClass(yt.taxableGain)}>{fmtSigned(yt.taxableGain)}</span>
          <small>steuerpflichtiger Gewinn (Haltedauer ≤ 1 Jahr)</small>
        </div>
        <div className="tax-bar" role="img" aria-label={`${Math.round(used * 100)} % der Freigrenze genutzt`}>
          <i style={{ width: `${used * 100}%` }} className={yt.exceeded ? 'over' : used > 0.75 ? 'near' : ''} />
        </div>
        <div className="tax-bar-legend">
          <span>{yt.exceeded ? '⚠︎ Freigrenze erreicht – gesamter Gewinn steuerpflichtig' : `Noch ${fmtEur(yt.remaining)} bis zur Freigrenze`}</span>
          <span>{fmtEur(FREIGRENZE_EUR)}</span>
        </div>
        <div className="row">
          <span className="row-label">Steuerfreie Gewinne (&gt; 1 Jahr gehalten)</span>
          <span className="row-value">{fmtEur(yt.taxFreeGain)}</span>
        </div>
        {yt.unknownCost > 0 && <p className="hint">{yt.unknownCost} Verkäufe ohne Einkaufspreis – deren Gewinn fehlt in der Rechnung.</p>}
        <p className="hint">
          Private Veräußerungsgeschäfte (§ 23 EStG): steuerfrei nach mehr als einem Jahr Haltedauer. Darunter bleiben Gewinne bis unter {fmtEur(FREIGRENZE_EUR)} im Jahr
          steuerfrei – wird die Freigrenze erreicht, ist alles steuerpflichtig. Verluste werden verrechnet. Hinweis, keine Steuerberatung.
        </p>
      </section>

      <section className="panel">
        <h2>Bald steuerfrei</h2>
        {soon.length === 0 && <p className="hint">Alles in deiner Sammlung ist schon länger als ein Jahr in deinem Besitz.</p>}
        {soon.slice(0, 12).map(({ i, free, value }) => (
          <div className="row" key={i.uid} onClick={() => navigate(`/card/${encodeURIComponent(i.cardId)}`)}>
            <span className="row-label">
              {i.nameEn ?? i.nameJa} {i.qty > 1 ? `×${i.qty}` : ''}
              <small>
                gekauft {new Date(boughtAt(i)).toLocaleDateString('de-DE')} · {value ? fmtEur(value) : ''}
              </small>
            </span>
            <span className="row-value">
              {new Date(free).toLocaleDateString('de-DE')}
              <small>in {daysUntil(free)} Tagen</small>
            </span>
          </div>
        ))}
        {freeNow.length > 0 && (
          <p className="hint">
            ✓ {freeNow.reduce((n, r) => n + r.i.qty, 0)} Stück im Wert von {fmtEur(freeValue)} sind schon steuerfrei verkaufbar.
          </p>
        )}
        <p className="hint">Ohne eingetragenes Kaufdatum zählt der Tag, an dem die Karte in die App kam.</p>
      </section>

      <section className="panel">
        <h2>Verkäufe</h2>
        {sales.length === 0 && <p className="hint">Noch keine Verkäufe. Im Portfolio über „Bearbeiten“ → 💶 eintragen – oder der KI sagen „Ich habe X für Y € verkauft“.</p>}
        {sales.slice(0, 40).map((s) => {
          const g = saleGain(s);
          const free = s.boughtAt && s.soldAt.slice(0, 10) >= taxFreeFrom(s.boughtAt);
          return (
            <div className="row" key={s.id}>
              <span className="row-label">
                {s.name} {s.qty > 1 ? `×${s.qty}` : ''}
                <small>
                  {new Date(s.soldAt).toLocaleDateString('de-DE')} · {s.channel} · {fmtEur(s.priceEur)}/Stk. · {free ? 'steuerfrei' : 'in Haltefrist'}
                </small>
              </span>
              <span className="row-value">
                <span className={marginClass(g)}>{g != null ? fmtSigned(g) : '–'}</span>
                <button className="link-btn" onClick={() => confirm('Verkauf löschen?') && removeSale(s.id)}>
                  löschen
                </button>
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
