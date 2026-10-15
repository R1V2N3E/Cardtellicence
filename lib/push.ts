// Push notifications (Web Push; works for the home-screen app on iOS 16.4+).
// The phone subscribes with its notification preferences and a copy of the deal settings;
// /api/push?action=check (after each daily scan and hourly) sends what is new:
//   - deals at or above the chosen net margin that weren't announced yet,
//   - watchlist cards back in stock at Card Rush, or noticeably cheaper there.
import webpush from 'web-push';
import { opportunityMargin } from '../src/margin.js';
import type { Settings } from '../src/state.js';
import { cardrushSet } from './cardrush.js';
import { cached, getJson } from './http.js';
import { kvConfigured, kvGet, kvSet } from './kv.js';
import type { OpportunityFile } from './types.js';

export interface PushPrefs {
  deals: boolean;
  minMarginEur: number;
  restock: boolean;
  priceDrop: boolean;
  /** The phone's deal settings, so margins match what the app shows. */
  settings: Settings;
  watch: { id: string; name: string; setId: string; number: string }[];
}

interface Subscriber {
  subscription: webpush.PushSubscription;
  prefs: PushPrefs;
  createdAt: string;
  /** What was already announced: deal id → date; watched card → last seen Card Rush state. */
  seenDeals: Record<string, string>;
  seenWatch: Record<string, { stock: number; price: number }>;
}

interface Message {
  title: string;
  body: string;
  url: string;
}

const SUBS = 'push:subs';
const MAX_SUBSCRIBERS = 20;
const REANNOUNCE_DAYS = 7;
const PRICE_DROP = 0.95;

export const pushConfigured = kvConfigured;

/** Signing keys are made once and kept in the store, so nothing has to be set up by hand. */
async function vapid(): Promise<{ publicKey: string; privateKey: string }> {
  const known = await kvGet<{ publicKey: string; privateKey: string }>('push:vapid');
  if (known) return known;
  const keys = webpush.generateVAPIDKeys();
  await kvSet('push:vapid', keys);
  return keys;
}

export async function publicKey(): Promise<string> {
  return (await vapid()).publicKey;
}

const loadSubs = async () => (await kvGet<Subscriber[]>(SUBS)) ?? [];

export async function subscribe(subscription: webpush.PushSubscription, prefs: PushPrefs, origin: string): Promise<void> {
  const subs = await loadSubs();
  const existing = subs.find((s) => s.subscription.endpoint === subscription.endpoint);
  if (existing) {
    existing.subscription = subscription;
    existing.prefs = prefs;
  } else {
    if (subs.length >= MAX_SUBSCRIBERS) subs.shift();
    subs.push({ subscription, prefs, createdAt: new Date().toISOString(), seenDeals: {}, seenWatch: {} });
  }
  await kvSet(SUBS, subs);
  if (!existing) await send(subscription, { title: 'Cardtelligence', body: 'Benachrichtigungen sind aktiv ✓', url: '/settings' }, origin).catch(() => {});
}

export async function unsubscribe(endpoint: string): Promise<void> {
  await kvSet(SUBS, (await loadSubs()).filter((s) => s.subscription.endpoint !== endpoint));
}

async function send(subscription: webpush.PushSubscription, msg: Message, origin: string) {
  const keys = await vapid();
  await webpush.sendNotification(subscription, JSON.stringify(msg), {
    TTL: 24 * 3600,
    vapidDetails: { subject: origin, publicKey: keys.publicKey, privateKey: keys.privateKey },
  });
}

const fmtEur = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €`;

function dealMessages(sub: Subscriber, scan: OpportunityFile | null): Message[] {
  if (!sub.prefs.deals || !scan) return [];
  const s = sub.prefs.settings;
  const now = Date.now();
  const fresh = (id: string) => !sub.seenDeals[id] || now - Date.parse(sub.seenDeals[id]) > REANNOUNCE_DAYS * 86400_000;
  const deals = scan.items
    .filter((o) => (o.cmTrend ?? 0) >= (s.minTrend ?? 0))
    .map((o) => ({ o, m: opportunityMargin(o, s, scan.fx.jpyToEur) }))
    .filter(({ m }) => m.buy && (m.marginEur ?? 0) >= sub.prefs.minMarginEur)
    .sort((a, b) => b.m.marginEur! - a.m.marginEur!);
  const news = deals.filter(({ o }) => fresh(o.id));
  for (const { o } of news) sub.seenDeals[o.id] = new Date().toISOString();
  // Forget old entries so the record stays small.
  for (const [id, at] of Object.entries(sub.seenDeals)) if (now - Date.parse(at) > 30 * 86400_000) delete sub.seenDeals[id];
  if (!news.length) return [];
  const top = news.slice(0, 3).map(({ o, m }) => `${o.nameEn ?? o.nameJa} +${fmtEur(m.marginEur!)}`);
  return [
    {
      title: news.length === 1 ? 'Neuer Deal' : `${news.length} neue Deals`,
      body: top.join(' · ') + (news.length > 3 ? ' …' : ''),
      url: news.length === 1 ? `/card/${encodeURIComponent(news[0].o.id)}` : '/',
    },
  ];
}

async function watchMessages(sub: Subscriber): Promise<Message[]> {
  const { watch, restock, priceDrop } = sub.prefs;
  if (!watch.length || (!restock && !priceDrop)) return [];
  const out: Message[] = [];
  for (const w of watch.slice(0, 100)) {
    const cr = (await cardrushSet(w.setId).catch(() => null))?.get(w.number);
    if (!cr) continue;
    const prev = sub.seenWatch[w.id];
    if (prev && restock && prev.stock === 0 && cr.stock > 0)
      out.push({ title: 'Wieder auf Lager', body: `${w.name}: Card Rush ¥${cr.priceJpy.toLocaleString('ja-JP')} (${cr.stock} Stück)`, url: `/card/${encodeURIComponent(w.id)}` });
    else if (prev && priceDrop && cr.priceJpy <= prev.price * PRICE_DROP)
      out.push({
        title: 'Preis gefallen',
        body: `${w.name}: Card Rush ¥${prev.price.toLocaleString('ja-JP')} → ¥${cr.priceJpy.toLocaleString('ja-JP')}`,
        url: `/card/${encodeURIComponent(w.id)}`,
      });
    sub.seenWatch[w.id] = { stock: cr.stock, price: cr.priceJpy };
  }
  return out;
}

/** Look for news for every subscriber and send it. Safe to call often: nothing is announced twice. */
export async function check(origin: string): Promise<{ subscribers: number; sent: number }> {
  const subs = await loadSubs();
  if (!subs.length) return { subscribers: 0, sent: 0 };
  const scan = await cached('scan-file', 10 * 60_000, () => getJson<OpportunityFile>(`${origin}/data/opportunities.json`)).catch(() => null);
  let sent = 0;
  const gone = new Set<string>();
  for (const sub of subs) {
    const msgs = [...dealMessages(sub, scan), ...(await watchMessages(sub))].slice(0, 4);
    for (const msg of msgs) {
      try {
        await send(sub.subscription, msg, origin);
        sent++;
      } catch (e) {
        // The phone unsubscribed or the app was removed: forget this subscription.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.add(sub.subscription.endpoint);
        break;
      }
    }
  }
  await kvSet(SUBS, subs.filter((s) => !gone.has(s.subscription.endpoint)));
  return { subscribers: subs.length - gone.size, sent };
}
