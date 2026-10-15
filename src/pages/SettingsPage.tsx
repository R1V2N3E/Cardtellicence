import { useEffect, useRef, useState } from 'react';
import { requestPersistence, storageStatus, type StorageStatus } from '../storage';
import { Chips, Header } from '../components/ui';
import { BUY_LABEL, SELL_LABEL } from '../margin';
import { DEFAULT_SETTINGS, readAccessCode, useCollection, useSettings, useWatchlist, writeAccessCode, type BuySource, type SellRef, type Valuation } from '../state';

export function SettingsPage() {
  const [s, setS] = useSettings();
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS({ ...s, [k]: v });
  const [code, setCode] = useState(readAccessCode());
  const collection = useCollection();
  const watch = useWatchlist();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    storageStatus().then(setStatus);
  }, []);

  const backup = () => {
    const data = { version: 2, exportedAt: new Date().toISOString(), collection: collection.items, watchlist: watch.list, settings: s };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `cardtelligence-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const restore = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const items = Array.isArray(data) ? data : data.collection ?? data.items;
      if (!Array.isArray(items)) throw new Error('format');
      if (!confirm(`Backup mit ${items.length} Sammlungs-Einträgen laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.`)) return;
      collection.replaceAll(items);
      if (Array.isArray(data.watchlist)) localStorage.setItem('ct-watch', JSON.stringify(data.watchlist));
      if (data.settings) setS({ ...DEFAULT_SETTINGS, ...data.settings });
      alert('Backup geladen.');
      location.reload();
    } catch {
      alert('Datei konnte nicht gelesen werden.');
    }
  };

  return (
    <>
      <Header title="Einstellungen" sub="Auf diesem Gerät gespeichert" />
      <section className="panel">
        <h2>Bewertung der Sammlung</h2>
        <Chips<Valuation>
          value={s.valuation}
          onChange={(v) => set('valuation', v)}
          options={[
            ['cardrush', 'Card Rush (Japan)'],
            ['cardmarket', 'Cardmarket (DE)'],
          ]}
        />
        <p className="hint">
          Card Rush ist in Japan die wichtigste Orientierung für Kartenwerte: Shop-Verkaufspreis in ¥, live umgerechnet in €, mehrmals täglich aktualisiert.
          Karten ohne Card-Rush-Preis werden mit Cardmarket bewertet.
        </p>
      </section>
      <section className="panel">
        <h2>Einkaufspreis (Japan)</h2>
        <Chips<BuySource> value={s.buySource} onChange={(v) => set('buySource', v)} options={(Object.keys(BUY_LABEL) as BuySource[]).map((k) => [k, BUY_LABEL[k]])} />
        <p className="hint">
          Card Rush = Japans Referenz-Shop (Preis + Lagerbestand, Standard). Yuyu-tei = fester Shoppreis mit Lagerbestand. SNKRDUNK = günstigstes Marktplatz-Angebot. Mercari = günstigstes aktives Angebot (nur
          Kartenseite). „Günstigster“ nimmt den niedrigsten verfügbaren Preis.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={s.includeSoldOut} onChange={(e) => set('includeSoldOut', e.target.checked)} />
          Shop-Preise (Card Rush, Yuyu-tei) auch bei „ausverkauft“ berücksichtigen
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
        <h2>Daten auf diesem iPhone</h2>
        <div className="row">
          <span className="row-label">Sammlung</span>
          <span className="row-value">{collection.items.reduce((n, i) => n + i.qty, 0)} Karten</span>
        </div>
        <div className="row">
          <span className="row-label">Merkliste</span>
          <span className="row-value">{watch.list.length} Karten</span>
        </div>
        <div className="row">
          <span className="row-label">Als App installiert</span>
          <span className="row-value">{status ? (status.installed ? '✓ ja' : '✗ nein – im Browser geöffnet') : '…'}</span>
        </div>
        <div className="row">
          <span className="row-label">Dauerhaft gespeichert</span>
          <span className="row-value">
            {status ? (status.persisted ? '✓ ja' : 'nein') : '…'}
            {status && !status.persisted && (
              <button className="chip" onClick={() => requestPersistence().then(() => storageStatus().then(setStatus))}>
                Anfordern
              </button>
            )}
          </span>
        </div>
        <p className="hint">
          Deine Daten liegen nur auf diesem Gerät (doppelt gesichert). Wichtig: Safari und die App auf dem Home-Bildschirm haben getrennte
          Speicher. Nutze immer das App-Symbol. Mach ab und zu ein Backup, z. B. in iCloud Drive über „In Dateien sichern“.
        </p>
        <div className="links">
          <button className="link-btn" onClick={backup}>
            Backup erstellen
          </button>
          <button className="link-btn" onClick={() => importInput.current?.click()}>
            Backup laden
          </button>
          <input ref={importInput} type="file" accept="application/json" hidden onChange={(e) => restore(e.target.files?.[0])} />
        </div>
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
