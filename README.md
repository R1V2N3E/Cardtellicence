# Cardtellicence

Mobile web app (installable on iPhone) for **Japan → Germany Pokémon card arbitrage**:
find Japanese cards that are cheap in Japan and sell for more on Cardmarket.

- **Deals**: daily scan of ~40 Japanese sets, ranked by margin € or ROI %.
- **Search**: English, German or Japanese names (`Charizard`, `Glurak`, `リザードン`), set + number (`SV2a 201`) or a whole set (`M2a`).
- **Card page**: photos, live prices from every source, margin calculator, sold-price charts (raw and PSA 10), last sales list, graded prices, links to each shop.
- **Scan**: photograph a card; Claude reads set code, number and name and the app matches the exact Japanese card. Add it to your collection with quantity, condition and purchase price.
- **Portfolio**: live value of your collection at Cardmarket prices, 7-day change, value chart, profit vs. purchase price, per-set view, JSON backup/restore.
- **Watchlist** and **Settings**; collection, watchlist and settings are stored on the device.

## Data sources

| Side | Source | What we use |
| --- | --- | --- |
| 🇩🇪 Sell | **Cardmarket**: official daily price guide export | Trend, low, 1/7/30-day averages for the *Japanese* printing (EUR) |
| 🇯🇵 Buy | **Yuyu-tei (遊々亭)** | Shop sell price and stock |
| 🇯🇵 Buy | **SNKRDUNK (スニダン)** | Lowest ask, every recent trade with condition, daily sold-price chart (A / PSA10 / PSA9) |
| 🇯🇵 Buy | **Mercari (メルカリ)** | Sold and active listings (graded, bundles and placeholder listings filtered out) |
| 🌍 Graded | **PriceCharting** | eBay PSA 10 / grade 9 / ungraded prices and history (USD) |
| 💱 | **ECB** reference rates | JPY→EUR, USD→EUR |
| 🗂 | **TCGdex** | Japanese card database, images, Cardmarket product ids |

**Card Rush** sits behind a Cloudflare bot challenge, so it can't be read by a server. The app links to it instead.

How cards are matched across sources:

- Cardmarket product: taken from TCGdex when available. For newer sets that TCGdex hasn't mapped yet (e.g. M2, SV11B), the set is matched to its Cardmarket expansion by name order; Cardmarket product ids follow card numbers. Such cards are flagged "matched by set position".
- Yuyu-tei: set code (`SV2a` → `sv02a`) plus printed number `201/165`.
- SNKRDUNK: product tag `[SV2a 201/165]`.
- Mercari: Japanese name plus number, then filtered.

Margin = Cardmarket price − Japanese price × ECB rate. Fees, shipping and import VAT are **not** deducted.

## Deploy (free) — about 10 minutes

1. **Vercel**: sign in at [vercel.com](https://vercel.com) with GitHub → *Add New… → Project* → import this repository → **Deploy**.
   No settings are needed: `vercel.json` sets the framework, runs the API in Tokyo (`hnd1`), and adds the routes.
2. **Daily scan**: GitHub → repository → *Settings → Actions → General* → *Workflow permissions* → **Read and write permissions** → Save.
   The `Daily price scan` workflow then runs every day at 03:17 UTC, commits `public/data/`, and Vercel redeploys automatically.
   To refresh deals right away: *Actions → Daily price scan → Run workflow* (optionally with a set list like `SV2a,M2a`).
3. **Card scanning** (optional, ~1 cent per scan): create an API key at [console.anthropic.com](https://console.anthropic.com) → in Vercel *Project → Settings → Environment Variables* add `ANTHROPIC_API_KEY`, and optionally `APP_ACCESS_CODE` (any password; enter the same in the app under Einstellungen so strangers can't scan on your bill) → *Redeploy*.
   Without a key the scanner still works: it asks you to type the number printed on the card (e.g. `116/80`).
4. **iPhone**: open your Vercel URL in **Safari** → **Share** → **Add to Home Screen**. It then opens full screen with its own icon.

## Develop

```bash
npm install
npm run dev        # app + API on http://localhost:5173 (API served by the same handlers as production)
npm test           # matching/parsing/margin unit tests
npm run scan       # run the scanner locally (SCAN_SETS=SV2a,M2a to limit)
npm run build
```

Layout:

```
api/          Vercel functions (thin wrappers)
lib/          source adapters (cardmarket, tcgdex, yuyutei, snkrdunk, mercari, pricecharting, fx), search, report
scripts/      scan.ts (daily scanner), gen-pokedex.mjs, gen-icons.mjs
src/          React PWA (Deals, Search, Card, Watchlist, Settings)
public/data/  scanner output: opportunities.json + history/<set>.json (price history for charts)
```

## Notes and limits

- The Japanese sources are read from public web pages and endpoints, so a site redesign can break one adapter. Each source fails on its own and the rest of the page still works.
- **Yuyu-tei and PriceCharting block cloud servers** (Vercel and GitHub Actions get HTTP 403). The card page then uses the Yuyu-tei price stored by the last scan that reached it, labelled with its date. The scanner keeps such prices for up to 14 days. Deals rank on SNKRDUNK asks, which work everywhere.
  To refresh Yuyu-tei prices, run `npm run scan` from a home connection and push `public/data/`.
- SNKRDUNK rate-limits bursts. The scanner looks up every card worth €5+ one at a time (about 15 minutes) and stops after repeated errors.
- Cardmarket and Yuyu-tei price *history* starts on the first scan and grows daily. SNKRDUNK and PriceCharting charts include their full history immediately.
- Eevee Heroes (S6a), Shiny Star V (S4a) and Pokémon GO (S10b) have no card list in TCGdex yet, so they aren't scanned. Search still links out for them.
