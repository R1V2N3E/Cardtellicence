import { useEffect, useRef, useState } from 'react';
import { requestPersistence, storageStatus, type StorageStatus } from '../storage';
import { DEFAULT_PUSH, disablePush, enablePush, pushServerStatus, pushSupport, readPush, usePushLocal, type PushLocal } from '../push';
import { Chips, Header } from '../components/ui';
import { BUY_LABEL, CHANNEL, SELL_LABEL } from '../margin';
import { DEFAULT_SETTINGS, readAccessCode, useCollection, useSettings, useWatchlist, writeAccessCode, type BuySource, type CostItem, type SellChannel, type SellRef, type Valuation } from '../state';

export function SettingsPage() {
  const [s, setS] = useSettings();
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS({ ...s, [k]: v });
  const cost = (k: CostItem, v: boolean) => setS({ ...s, costOn: { ...s.costOn, [k]: v } });
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
            ['cardrush', 'Card Rush Verkauf'],
            ['cardrushBuy', 'Card Rush Ankauf'],
            ['cardmarket', 'Cardmarket (DE)'],
          ]}
        />
        <p className="hint">
          Card Rush ist in Japan die wichtigste Orientierung für Kartenwerte, live in € umgerechnet und mehrmals täglich aktualisiert. „Verkauf“ =
          Shop-Preis (Marktwert), „Ankauf“ = was Card Rush dir zahlt. Karten ohne Card-Rush-Preis werden mit Cardmarket bewertet.
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
      <PushSettings />
      <section className="panel">
        <h2>Kosten (Netto-Marge)</h2>
        <label className="toggle">
          <input type="checkbox" checked={s.net} onChange={(e) => set('net', e.target.checked)} />
          Margen netto rechnen (empfohlen)
        </label>
        {s.net && (
          <>
            <h3 className="sub-h2">Kauf in Japan → Verkauf in Deutschland</h3>
            <NumberField label="Proxy-/Zahlungsgebühr" unit="%" value={s.proxyPct} onChange={(v) => set('proxyPct', v)} on={s.costOn.proxy} onToggle={(v) => cost('proxy', v)} />
            <NumberField label="Versand JP → DE pro Karte" unit="€" value={s.shipEur} onChange={(v) => set('shipEur', v)} on={s.costOn.ship} onToggle={(v) => cost('ship', v)} />
            <NumberField label="Versand pro Box/Pack" unit="€" value={s.shipSealedEur} onChange={(v) => set('shipSealedEur', v)} on={s.costOn.ship} onToggle={(v) => cost('ship', v)} />
            <NumberField label="Zoll" unit="%" value={s.dutyPct} onChange={(v) => set('dutyPct', v)} on={s.costOn.duty} onToggle={(v) => cost('duty', v)} />
            <NumberField label="Einfuhrumsatzsteuer" unit="%" value={s.vatPct} onChange={(v) => set('vatPct', v)} on={s.costOn.vat} onToggle={(v) => cost('vat', v)} />
            <label className="toggle">
              <input type="checkbox" checked={s.costOn.sellFee} onChange={(e) => cost('sellFee', e.target.checked)} />
              Verkaufsgebühr abziehen
            </label>
            {s.costOn.sellFee && (
              <div className="field-col">
                <span>Verkauf über</span>
                <Chips<SellChannel>
                  value={s.sellChannel}
                  onChange={(v) => set('sellChannel', v)}
                  options={(Object.keys(CHANNEL) as SellChannel[]).map((k) => [k, CHANNEL[k].label])}
                />
              </div>
            )}
            <h3 className="sub-h2">Kauf in Deutschland → Verkauf in Japan</h3>
            <div className="field-col">
              <span>Kaufpreis Cardmarket</span>
              <Chips<SellRef> value={s.revBuyRef} onChange={(v) => set('revBuyRef', v)} options={(Object.keys(SELL_LABEL) as SellRef[]).map((k) => [k, SELL_LABEL[k]])} />
            </div>
            <NumberField label="Versand pro Karte (zu dir + nach Japan)" unit="€" value={s.revShipEur} onChange={(v) => set('revShipEur', v)} on={s.costOn.revShip} onToggle={(v) => cost('revShip', v)} />
            <NumberField label="Japan-Einfuhrsteuer (Post über ¥10.000)" unit="%" value={s.revTaxPct} onChange={(v) => set('revTaxPct', v)} on={s.costOn.revTax} onToggle={(v) => cost('revTax', v)} />
          </>
        )}
        <p className="hint">
          Netto = Verkaufspreis − Verkaufsgebühr − (Kaufpreis + Proxy-Gebühr + Versand + Zoll + 19 % Einfuhrumsatzsteuer). Die Steuer fällt beim
          Import auf Ware + Versand an; Sammelkarten sind in der Regel zollfrei. Wer vor Ort in Japan kauft und mitbringt: Proxy 0 % und Versand 0 €
          setzen (Freimenge 430 € bei Flugreisen beachten).
        </p>
      </section>
      <section className="panel">
        <h2>Grading (PSA)</h2>
        <NumberField label="Kosten pro Karte inkl. Versand" unit="€" value={s.gradingEur} onChange={(v) => set('gradingEur', v)} />
        <NumberField label="Erwartete PSA-10-Quote" unit="%" value={s.psa10Pct} onChange={(v) => set('psa10Pct', v)} />
        <p className="hint">Für den Grading-Rechner auf jeder Kartenseite.</p>
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

function NumberField({
  label,
  unit,
  value,
  onChange,
  on,
  onToggle,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  /** With a switch: the cost can be turned off without losing its value. */
  on?: boolean;
  onToggle?: (on: boolean) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className={`field ${on === false ? 'off' : ''}`}>
      {onToggle ? (
        <span className="field-toggle">
          <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
          {label}
        </span>
      ) : (
        label
      )}
      <span className="num-input">
        <input
          className="input"
          inputMode="decimal"
          value={text}
          disabled={on === false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = Number(text.replace(',', '.'));
            if (Number.isFinite(v) && v >= 0) onChange(v);
            else setText(String(value));
          }}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}

function PushSettings() {
  const local = usePushLocal();
  const [prefs, setPrefs] = useState<Omit<PushLocal, 'endpoint'>>(() => {
    const p = readPush();
    if (!p) return DEFAULT_PUSH;
    const { endpoint: _e, ...rest } = p;
    return rest;
  });
  const [server, setServer] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const support = pushSupport();
  useEffect(() => {
    pushServerStatus()
      .then((s) => setServer(!!s.configured))
      .catch(() => setServer(false));
  }, []);

  const update = (p: Omit<PushLocal, 'endpoint'>) => {
    setPrefs(p);
    // Already on: store locally; the app syncs the server copy in the background.
    if (local) {
      localStorage.setItem('ct-push', JSON.stringify({ ...p, endpoint: local.endpoint }));
      window.dispatchEvent(new CustomEvent('ct-storage', { detail: 'ct-push' }));
    }
  };
  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (local) await disablePush();
      else {
        await enablePush(prefs);
        setMsg('Aktiv ✓ – eine Testmitteilung ist unterwegs.');
      }
    } catch (e) {
      const m = (e as Error).message;
      setMsg(m === 'not_configured' ? 'Der Server ist noch nicht eingerichtet (siehe unten).' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Benachrichtigungen</h2>
      {support === 'not-installed' && <p className="hint">Nur in der Home-Bildschirm-App möglich: in Safari „Teilen → Zum Home-Bildschirm“, dann von dort öffnen.</p>}
      {support === 'unsupported' && <p className="hint">Dieses Gerät unterstützt keine Web-Mitteilungen (iOS 16.4 oder neuer nötig).</p>}
      {support === 'ok' && (
        <>
          <button className={local ? 'link-btn' : 'primary-btn'} disabled={busy || server === false} onClick={toggle}>
            {busy ? '…' : local ? 'Benachrichtigungen ausschalten' : 'Benachrichtigungen einschalten'}
          </button>
          {msg && <p className="hint">{msg}</p>}
        </>
      )}
      <label className="toggle">
        <input type="checkbox" checked={prefs.deals} onChange={(e) => update({ ...prefs, deals: e.target.checked })} />
        Neue Deals ab
      </label>
      <NumberField label="Mindest-Marge (netto)" unit="€" value={prefs.minMarginEur} onChange={(v) => update({ ...prefs, minMarginEur: v })} />
      <label className="toggle">
        <input type="checkbox" checked={prefs.restock} onChange={(e) => update({ ...prefs, restock: e.target.checked })} />
        Merkliste: wieder auf Lager bei Card Rush
      </label>
      <label className="toggle">
        <input type="checkbox" checked={prefs.priceDrop} onChange={(e) => update({ ...prefs, priceDrop: e.target.checked })} />
        Merkliste: Preis bei Card Rush um 5 % gefallen
      </label>
      {server === false && (
        <p className="hint">
          Einrichtung (einmalig, kostenlos): Vercel → Projekt → Storage → „Create Database“ → Upstash Redis (Free) → mit dem Projekt verbinden → Redeploy.
          Danach hier einschalten. Schlüssel und Abos legt die App selbst an.
        </p>
      )}
      <p className="hint">Neue Deals kommen nach dem täglichen Scan, Merkliste-Meldungen bis zu stündlich.</p>
    </section>
  );
}
