// Price alerts set by the assistant: checked when the app opens and every 15 minutes while it is
// open. A hit shows a banner (and a system notification when allowed).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtEur, fmtJpy } from '../format';
import { alertText, readAlerts, removeAlert, saveAlerts, useAlerts, type PriceAlert } from './store';

const EVERY_MS = 15 * 60_000;

function hit(a: PriceAlert, eur: number | null, crBuy: number | null) {
  return (
    (a.belowEur != null && eur != null && eur <= a.belowEur) ||
    (a.aboveEur != null && eur != null && eur >= a.aboveEur) ||
    (a.crBuyAboveJpy != null && crBuy != null && crBuy >= a.crBuyAboveJpy)
  );
}

export function useAlertCheck() {
  const [hits, setHits] = useState<PriceAlert[]>([]);
  useEffect(() => {
    const check = async () => {
      const open = readAlerts().filter((a) => !a.triggeredAt);
      if (!open.length) return;
      const res = await api.prices([...new Set(open.map((a) => a.cardId))]).catch(() => null);
      if (!res) return;
      const now = new Date().toISOString();
      const fired: PriceAlert[] = [];
      const next = readAlerts().map((a) => {
        const p = res.prices[a.cardId];
        if (!p || a.triggeredAt) return a;
        const seen = { eur: p.trend, crBuyJpy: p.cr?.buyJpy ?? null };
        if (hit(a, seen.eur, seen.crBuyJpy)) {
          const f = { ...a, triggeredAt: now, lastSeen: seen };
          fired.push(f);
          return f;
        }
        return { ...a, lastSeen: seen };
      });
      saveAlerts(next);
      if (!fired.length) return;
      setHits((h) => [...h, ...fired]);
      if ('Notification' in window && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
        for (const f of fired) {
          const body = `${f.name}: ${f.lastSeen?.eur != null ? fmtEur(f.lastSeen.eur) : ''} – Alarm „${alertText(f)}“`;
          if (reg) void reg.showNotification('Cardtelligence Preisalarm', { body, tag: f.id, data: { url: `/card/${f.cardId}` } });
        }
      }
    };
    void check();
    const t = setInterval(check, EVERY_MS);
    const vis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  return { hits, dismiss: (id: string) => setHits((h) => h.filter((x) => x.id !== id)) };
}

export function AlertBanner({ hits, dismiss }: ReturnType<typeof useAlertCheck>) {
  if (!hits.length) return null;
  const a = hits[0];
  return (
    <div className="alert-banner" role="status">
      <span>🔔</span>
      <Link to={`/card/${encodeURIComponent(a.cardId)}`} onClick={() => dismiss(a.id)}>
        <b>{a.name}</b>
        <small>
          {a.lastSeen?.eur != null ? fmtEur(a.lastSeen.eur) : ''}
          {a.lastSeen?.crBuyJpy ? ` · Ankauf ${fmtJpy(a.lastSeen.crBuyJpy)}` : ''} – {alertText(a)}
        </small>
      </Link>
      <button onClick={() => dismiss(a.id)} aria-label="Schließen">✕</button>
    </div>
  );
}

export function AlertsPanel() {
  const [alerts] = useAlerts();
  if (!alerts.length) return null;
  return (
    <section className="panel">
      <h2>Preisalarme</h2>
      {alerts.map((a) => (
        <div className="row" key={a.id}>
          <span className="row-label">
            <Link to={`/card/${encodeURIComponent(a.cardId)}`}>{a.name}</Link>
            <small className="muted">
              {' '}
              {alertText(a)}
              {a.triggeredAt ? ` · ausgelöst ${new Date(a.triggeredAt).toLocaleDateString('de-DE')}` : a.lastSeen?.eur != null ? ` · zuletzt ${fmtEur(a.lastSeen.eur)}` : ''}
            </small>
          </span>
          <button className="link-btn" onClick={() => removeAlert(a.id)}>
            löschen
          </button>
        </div>
      ))}
      <p className="hint">Alarme legst du über die KI an, z. B. „Sag Bescheid, wenn Glurak 151 unter 300 € fällt“.</p>
    </section>
  );
}
