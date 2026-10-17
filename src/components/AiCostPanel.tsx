import { useMemo } from 'react';
import { api, useAsync } from '../api';
import { KIND_LABEL, sumUsage, useUsage, type AiKind } from '../ai/usage';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const eur = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: 2 });

/** Settings → what the AI features have cost on this device (list-price estimate). */
export function AiCostPanel() {
  const [days] = useUsage();
  const { data: fx } = useAsync(() => api.fx(), []);
  const usdToEur = fx?.usdToEur ?? 0.92;
  const now = new Date();
  const today = iso(now);
  const monthStart = today.slice(0, 8) + '01';
  const t = sumUsage(days, today, today);
  const m = sumUsage(days, monthStart);
  const all = sumUsage(days, '0000');

  // Last 14 days, one bar per day.
  const bars = useMemo(() => {
    const out: { date: string; usd: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = iso(new Date(Date.now() - i * 86400_000));
      out.push({ date: d, usd: sumUsage(days, d, d).usd });
    }
    return out;
  }, [days]);
  const max = Math.max(...bars.map((b) => b.usd), 0.0001);

  return (
    <section className="panel">
      <h2>KI-Kosten</h2>
      <div className="cost-stats">
        <div>
          <small>Heute</small>
          <b>{eur(t.usd * usdToEur)}</b>
          <span>{t.n} Anfragen</span>
        </div>
        <div>
          <small>{now.toLocaleDateString('de-DE', { month: 'long' })}</small>
          <b>{eur(m.usd * usdToEur)}</b>
          <span>{m.n} Anfragen</span>
        </div>
        <div>
          <small>Gesamt</small>
          <b>{eur(all.usd * usdToEur)}</b>
          <span>{all.n} Anfragen</span>
        </div>
      </div>

      <div className="cost-bars" role="img" aria-label="KI-Kosten der letzten 14 Tage">
        {bars.map((b) => (
          <div key={b.date} className="cost-bar" title={`${new Date(b.date).toLocaleDateString('de-DE')}: ${eur(b.usd * usdToEur)}`}>
            <i style={{ height: `${Math.max(b.usd > 0 ? 4 : 0, (b.usd / max) * 100)}%` }} />
            <span>{new Date(b.date).getDate()}</span>
          </div>
        ))}
      </div>
      <p className="cost-caption">Letzte 14 Tage · höchster Tag {eur(max * usdToEur)}</p>

      {m.n > 0 && (
        <>
          <h3 className="cd-sub">Diesen Monat nach Funktion</h3>
          {(Object.entries(m.byKind) as [AiKind, { n: number; usd: number }][])
            .sort((a, b) => b[1].usd - a[1].usd)
            .map(([k, v]) => (
              <div className="row" key={k}>
                <span className="row-label">
                  {KIND_LABEL[k]}
                  <small className="muted"> · {v.n}× · Ø {eur((v.usd / v.n) * usdToEur)}</small>
                </span>
                <span className="row-value">{eur(v.usd * usdToEur)}</span>
              </div>
            ))}
        </>
      )}
      <p className="hint">
        Schätzung zum Listenpreis (Claude Opus 5.5: Eingabe 4 $, Ausgabe 20 $ je Million Tokens; Websuche 1 Cent), umgerechnet zum EZB-Kurs. Gezählt wird nur, was auf diesem
        Gerät angefragt wurde. Die genaue Abrechnung und ein festes Ausgabelimit findest du in der Anthropic Console.
      </p>
    </section>
  );
}
