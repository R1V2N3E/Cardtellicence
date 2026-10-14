import { useState } from 'react';
import { Chips, Header } from '../components/ui';
import { BUY_LABEL, SELL_LABEL } from '../margin';
import { DEFAULT_SETTINGS, readAccessCode, useSettings, writeAccessCode, type BuySource, type SellRef } from '../state';

export function SettingsPage() {
  const [s, setS] = useSettings();
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS({ ...s, [k]: v });
  const [code, setCode] = useState(readAccessCode());

  return (
    <>
      <Header title="Einstellungen" sub="Auf diesem Gerät gespeichert" />
      <section className="panel">
        <h2>Einkaufspreis (Japan)</h2>
        <Chips<BuySource> value={s.buySource} onChange={(v) => set('buySource', v)} options={(Object.keys(BUY_LABEL) as BuySource[]).map((k) => [k, BUY_LABEL[k]])} />
        <p className="hint">
          Yuyu-tei = fester Shoppreis mit Lagerbestand. SNKRDUNK = günstigstes Marktplatz-Angebot. Mercari = günstigstes aktives Angebot (nur
          Kartenseite). „Günstigster“ nimmt den niedrigsten verfügbaren Preis.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={s.includeSoldOut} onChange={(e) => set('includeSoldOut', e.target.checked)} />
          Yuyu-tei-Preise auch bei „ausverkauft“ berücksichtigen
        </label>
      </section>
      <section className="panel">
        <h2>Verkaufspreis (Cardmarket)</h2>
        <Chips<SellRef> value={s.sellRef} onChange={(v) => set('sellRef', v)} options={(Object.keys(SELL_LABEL) as SellRef[]).map((k) => [k, SELL_LABEL[k]])} />
        <p className="hint">
          Trend ist Cardmarkets eigene Preisschätzung. Der 30-Tage-Durchschnitt ist stabiler. „Niedrigster“ ist das günstigste aktuelle Angebot, also das, was du unterbieten müsstest.
        </p>
      </section>
      <section className="panel">
        <h2>Deals-Filter</h2>
        <label className="field">
          Mindestpreis Cardmarket
          <select className="select" value={s.minTrend} onChange={(e) => set('minTrend', Number(e.target.value))}>
            {[3, 5, 10, 20, 50, 100, 200].map((v) => (
              <option key={v} value={v}>
                € {v}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="panel">
        <h2>Kartenerkennung</h2>
        <label className="field">
          Zugangscode
          <input
            className="input narrow"
            type="password"
            autoComplete="off"
            placeholder="falls eingerichtet"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              writeAccessCode(e.target.value);
            }}
          />
        </label>
        <p className="hint">Nur nötig, wenn in Vercel die Variable APP_ACCESS_CODE gesetzt ist. Sie verhindert, dass Fremde über deine Seite Scans auf deine Kosten auslösen.</p>
      </section>
      <section className="panel">
        <h2>Auf dem iPhone installieren</h2>
        <p className="hint">
          In Safari auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b> tippen. Die App öffnet sich dann im Vollbild wie eine native App.
        </p>
        <button className="link-btn" onClick={() => setS(DEFAULT_SETTINGS)}>
          Einstellungen zurücksetzen
        </button>
      </section>
      <section className="panel">
        <h2>Quellen</h2>
        <p className="hint">
          🇩🇪 Cardmarket offizieller Preisguide (japanische Ausgaben) · 🇯🇵 Yuyu-tei Shoppreise, SNKRDUNK Angebote & Verkäufe, Mercari verkaufte Angebote ·
          🌍 PriceCharting (eBay-Verkäufe gegradeter Karten) · 💱 EZB-Referenzkurse · Kartendaten: TCGdex · Kartenerkennung: Claude.
        </p>
      </section>
    </>
  );
}
