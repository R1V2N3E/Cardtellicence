// Push notifications on this phone: subscribe/unsubscribe and keep the server's copy of the
// preferences (deal settings, watchlist) in sync.
import { useEffect, useState } from 'react';
import { readAccessCode, readSettings, readWatchlist } from './state';
import { mirror } from './storage';

export interface PushLocal {
  endpoint: string;
  deals: boolean;
  minMarginEur: number;
  restock: boolean;
  priceDrop: boolean;
}

const KEY = 'ct-push';
export const DEFAULT_PUSH: Omit<PushLocal, 'endpoint'> = { deals: true, minMarginEur: 50, restock: true, priceDrop: true };

export function readPush(): PushLocal | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

function writePush(p: PushLocal | null) {
  const raw = p ? JSON.stringify(p) : null;
  if (raw) localStorage.setItem(KEY, raw);
  else localStorage.removeItem(KEY);
  mirror(KEY, raw);
  window.dispatchEvent(new CustomEvent('ct-storage', { detail: KEY }));
}

export type PushSupport = 'ok' | 'not-installed' | 'unsupported';

export function pushSupport(): PushSupport {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return standalone ? 'unsupported' : 'not-installed';
  return 'ok';
}

const toKey = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function post(action: string, body: unknown) {
  const res = await fetch(`/api/push?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-code': readAccessCode() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error === 'access_code' ? 'Zugangscode fehlt oder ist falsch (Einstellungen → Kartenerkennung).' : data.configured === false ? 'not_configured' : `Fehler ${res.status}`);
  return data;
}

function prefsFor(local: Omit<PushLocal, 'endpoint'>) {
  return {
    ...local,
    settings: readSettings(),
    watch: readWatchlist().map((w) => ({ id: w.id, name: w.nameEn ?? w.nameJa, setId: w.setId, number: w.number })),
  };
}

export async function pushServerStatus(): Promise<{ configured: boolean; publicKey?: string }> {
  return fetch('/api/push?action=key').then((r) => r.json());
}

export async function enablePush(local: Omit<PushLocal, 'endpoint'>): Promise<void> {
  const status = await pushServerStatus();
  if (!status.configured || !status.publicKey) throw new Error('not_configured');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt (iPhone-Einstellungen → Mitteilungen → Cardtelligence).');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(status.publicKey) }));
  await post('subscribe', { subscription: sub.toJSON(), prefs: prefsFor(local) });
  writePush({ ...local, endpoint: sub.endpoint });
}

export async function disablePush(): Promise<void> {
  const cur = readPush();
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => {});
  if (cur) await post('unsubscribe', { endpoint: cur.endpoint }).catch(() => {});
  writePush(null);
}

/** Send the current preferences (after a settings or watchlist change). */
export async function syncPush(): Promise<void> {
  const cur = readPush();
  if (!cur || pushSupport() !== 'ok') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return writePush(null); // permission was withdrawn on the phone
  const { endpoint: _e, ...local } = cur;
  await post('subscribe', { subscription: sub.toJSON(), prefs: prefsFor(local) });
}

/** Keeps the server's copy in sync while the app runs (debounced). */
export function usePushSync() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const key = (e as CustomEvent).detail;
      if (key !== 'ct-settings' && key !== 'ct-watch' && key !== KEY) return;
      clearTimeout(t);
      t = setTimeout(() => void syncPush().catch(() => {}), 2000);
    };
    window.addEventListener('ct-storage', on);
    void syncPush().catch(() => {});
    return () => window.removeEventListener('ct-storage', on);
  }, []);
}

export function usePushLocal(): PushLocal | null {
  const [v, setV] = useState(readPush);
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent).detail === KEY && setV(readPush());
    window.addEventListener('ct-storage', on);
    return () => window.removeEventListener('ct-storage', on);
  }, []);
  return v;
}
