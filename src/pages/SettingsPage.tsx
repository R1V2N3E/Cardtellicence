import { Chips, Header } from '../components/ui';
import { BUY_LABEL, SELL_LABEL } from '../margin';
import { DEFAULT_SETTINGS, useSettings, type BuySource, type SellRef } from '../state';

export function SettingsPage() {
  const [s, setS] = useSettings();
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS({ ...s, [k]: v });

  return (
    <>
      <Header title="Settings" sub="Saved on this device" />
      <section className="panel">
        <h2>Buy price (Japan)</h2>
        <Chips<BuySource> value={s.buySource} onChange={(v) => set('buySource', v)} options={(Object.keys(BUY_LABEL) as BuySource[]).map((k) => [k, BUY_LABEL[k]])} />
        <p className="hint">
          Yuyu-tei = fixed shop price with stock. SNKRDUNK = lowest marketplace ask. Mercari = lowest active listing (card page only).
          Cheapest picks the lowest available.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={s.includeSoldOut} onChange={(e) => set('includeSoldOut', e.target.checked)} />
          Count Yuyu-tei prices even when sold out
        </label>
      </section>
      <section className="panel">
        <h2>Sell price (Cardmarket)</h2>
        <Chips<SellRef> value={s.sellRef} onChange={(v) => set('sellRef', v)} options={(Object.keys(SELL_LABEL) as SellRef[]).map((k) => [k, SELL_LABEL[k]])} />
        <p className="hint">Trend is Cardmarket’s own price estimate. The 30-day average is steadier. Lowest is the cheapest current offer, i.e. what you’d have to undercut.</p>
      </section>
      <section className="panel">
        <h2>Deals filter</h2>
        <label className="field">
          Minimum Cardmarket price
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
        <h2>Install on iPhone</h2>
        <p className="hint">
          In Safari tap <b>Share</b> → <b>Add to Home Screen</b>. The app then opens full screen like a native app.
        </p>
        <button className="link-btn" onClick={() => setS(DEFAULT_SETTINGS)}>
          Reset settings
        </button>
      </section>
      <section className="panel">
        <h2>Sources</h2>
        <p className="hint">
          🇩🇪 Cardmarket official price guide (Japanese printings) · 🇯🇵 Yuyu-tei shop prices, SNKRDUNK asks & trades, Mercari sold
          listings · 🌍 PriceCharting (eBay graded sales) · 💱 ECB reference rates. Card data: TCGdex.
        </p>
      </section>
    </>
  );
}
