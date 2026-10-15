import { fmtEur } from '../format';
import type { Margin } from '../margin';

/** Where the net margin comes from: landed cost in Germany and the proceeds after the sales fee. */
export function CostLines({ m }: { m: Margin }) {
  const c = m.costs!;
  const parts = [
    ['Proxy/Gebühr', c.proxy],
    ['Versand', c.ship],
    ['Zoll', c.duty],
    ['EUSt', c.vat],
  ].filter(([, v]) => (v as number) > 0.005) as [string, number][];
  return (
    <div className="cost-lines">
      <div>
        <span>Einstand in DE</span>
        <b>{fmtEur(m.landedEur)}</b>
      </div>
      <small>
        Kauf {fmtEur(m.buyEur)}
        {parts.map(([l, v]) => ` + ${l} ${fmtEur(v)}`).join('')}
      </small>
      <div>
        <span>Erlös nach Verkaufsgebühr</span>
        <b>{fmtEur(m.proceedsEur)}</b>
      </div>
      {c.sellFee > 0.005 && <small>Verkauf {fmtEur(m.sellEur)} − Gebühr {fmtEur(c.sellFee)}</small>}
    </div>
  );
}
