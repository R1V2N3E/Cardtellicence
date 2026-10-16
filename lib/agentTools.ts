// Tools of the Cardtelligence agent. The server sends these definitions to Claude; the app
// runs them in the browser, where the user's collection, settings and the market data live.
// (Only web search runs on Anthropic's side.)
import type Anthropic from '@anthropic-ai/sdk';

export const AGENT_TOOL_NAMES = [
  'search_cards',
  'card_details',
  'compute_margin',
  'market_overview',
  'find_opportunities',
  'portfolio',
  'sell_options',
  'tax_overview',
  'show_cards',
  'propose_action',
  'open_tool',
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});

export const AGENT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_cards',
    description:
      'Find Japanese Pokémon cards and sealed products by name (English or Japanese), set code (e.g. SV2a, sm12a), collector number ("201/165"), rarity or Pokémon. Returns ids with current prices (Cardmarket trend €, Card Rush sell/buy ¥) and momentum. Use this first whenever the user names a card; then card_details for depth.',
    input_schema: obj(
      {
        query: { type: 'string', description: 'Free text: name, set code, number, rarity …' },
        set_id: { type: 'string', description: 'Restrict to one set code' },
        max_eur: { type: 'number', description: 'Only cards with a Cardmarket trend at or below this' },
        min_eur: { type: 'number' },
        sort: { type: 'string', enum: ['value', 'momentum', 'margin', 'jp_premium'] },
        limit: { type: 'integer', description: 'Default 10, max 40' },
      },
      ['query'],
    ),
  },
  {
    name: 'card_details',
    description:
      'Everything about one card: all live prices (Cardmarket trend/avg/low, Card Rush sell + buyback with stock, SNKRDUNK, Yuyu-tei, Mercari listings), price history, both trade directions (JP→DE margin and DE→JP buyback) with the user\'s cost settings, and how many the user owns.',
    input_schema: obj({ id: { type: 'string', description: 'Card id from search_cards, e.g. SV2a-201' } }, ['id']),
  },
  {
    name: 'compute_margin',
    description:
      'Net margin of a trade with the user\'s cost model (proxy fee, shipping, duty, import VAT, selling fee — each switchable). Give a buy price in ¥ (Japan) or € and a sell price in €, or a card id to fill in what is missing from live prices. Use for shop prices, offers, "is ¥X a good price".',
    input_schema: obj({
      card_id: { type: 'string' },
      buy_jpy: { type: 'number' },
      buy_eur: { type: 'number' },
      sell_eur: { type: 'number' },
      sealed: { type: 'boolean', description: 'Sealed product (other shipping cost)' },
    }),
  },
  {
    name: 'market_overview',
    description:
      'Market analytics from the daily scan of all tracked cards: total value, generations (MEGA, Karmesin & Purpur, Schwert & Schild, Sonne & Mond), set ranking with momentum (7-day vs 30-day average sale price), JP premium, daily value index. With set_id: that set in depth (value composition, movers, laggards).',
    input_schema: obj({
      set_id: { type: 'string' },
      era: { type: 'string', enum: ['mega', 'sv', 'swsh', 'sm'] },
    }),
  },
  {
    name: 'find_opportunities',
    description:
      'Ranked opportunity lists. deals: buy in Japan (Card Rush) → sell in Germany, net margin. reverse: buy on Cardmarket → sell to Card Rush buyback. sealed: boxes/packs JP→DE. laggards: cards lagging behind a rising set. jp_premium: Japan values them far above Europe. gainers / losers: strongest momentum.',
    input_schema: obj(
      {
        kind: { type: 'string', enum: ['deals', 'reverse', 'sealed', 'laggards', 'jp_premium', 'gainers', 'losers'] },
        set_id: { type: 'string' },
        min_eur: { type: 'number', description: 'Minimum card value (default 5)' },
        budget_eur: { type: 'number', description: 'Only buys up to this price per item' },
        limit: { type: 'integer', description: 'Default 10, max 30' },
      },
      ['kind'],
    ),
  },
  {
    name: 'portfolio',
    description:
      'The user\'s collection: every item with quantity, condition, purchase price and date, current value, gain, holding period and the date it can be sold tax-free (private seller, 1-year holding period). Plus totals, value per set and recorded sales.',
    input_schema: obj({ set_id: { type: 'string' } }),
  },
  {
    name: 'sell_options',
    description:
      'Where to sell a card for the most money: net proceeds per channel (Cardmarket, eBay private, Kleinanzeigen, Card Rush buyback in Japan incl. shipping), quick-sale vs. best price, and — if the user owns it — gain and tax effect (holding period, yearly exemption limit). Call before writing a listing.',
    input_schema: obj(
      {
        id: { type: 'string' },
        condition: { type: 'string', enum: ['NM', 'LP', 'MP', 'HP', 'PSA10', 'PSA9'] },
        qty: { type: 'integer' },
      },
      ['id'],
    ),
  },
  {
    name: 'tax_overview',
    description:
      'Private sales tax status (Germany, § 23 EStG): realized gains this year from recorded sales vs. the 1,000 € exemption limit (Freigrenze), items already tax-free (held > 1 year), items becoming tax-free soon, and what selling a specific item now would mean.',
    input_schema: obj({ year: { type: 'integer' } }),
  },
  {
    name: 'show_cards',
    description: 'Show cards as tappable tiles with picture and price in the chat. Use when you recommend or compare specific cards.',
    input_schema: obj(
      {
        ids: { type: 'array', items: { type: 'string' }, description: 'Up to 12 card ids' },
        title: { type: 'string' },
      },
      ['ids'],
    ),
  },
  {
    name: 'propose_action',
    description:
      'Propose a change to the user\'s data. The user sees a card with your summary and confirms or declines by tap; the result tells you which. Never claim a change happened before the result says confirmed. watch_add: add to watchlist. collection_add: add to collection. sale_record: record a sale (removes from collection, logs gain for the tax overview). alert_add: price alert (below/above € on Cardmarket, or Card Rush buyback above ¥). remember: keep a preference or fact about the user for future chats.',
    input_schema: obj(
      {
        action: { type: 'string', enum: ['watch_add', 'collection_add', 'sale_record', 'alert_add', 'remember'] },
        summary: { type: 'string', description: 'One sentence the user confirms, in German' },
        card_id: { type: 'string' },
        qty: { type: 'integer' },
        condition: { type: 'string', enum: ['NM', 'LP', 'MP', 'HP', 'PSA10', 'PSA9'] },
        cost_amount: { type: 'number', description: 'collection_add: price paid per copy' },
        cost_currency: { type: 'string', enum: ['JPY', 'EUR'] },
        price_eur: { type: 'number', description: 'sale_record: sale price per copy in €' },
        fees_eur: { type: 'number', description: 'sale_record: fees + shipping paid in total' },
        channel: { type: 'string', description: 'sale_record: where it was sold' },
        below_eur: { type: 'number', description: 'alert_add' },
        above_eur: { type: 'number', description: 'alert_add' },
        cr_buy_above_jpy: { type: 'number', description: 'alert_add: Card Rush buyback above' },
        fact: { type: 'string', description: 'remember: the fact, short' },
      },
      ['action', 'summary'],
    ),
  },
  {
    name: 'open_tool',
    description:
      'Offer a button that opens one of the app\'s camera tools: scan (identify one card), shop (photo of a shop showcase → every card with its price tag rated buy/skip), condition (condition, centering, PSA-10 chance and authenticity hints from a photo).',
    input_schema: obj(
      {
        tool: { type: 'string', enum: ['scan', 'shop', 'condition'] },
        card_id: { type: 'string' },
        label: { type: 'string' },
      },
      ['tool'],
    ),
  },
];
