// Keeps the user's data on this iPhone as safely as a web app can:
// - asks the browser for persistent storage (not evicted under storage pressure),
// - mirrors every saved key into IndexedDB as a second copy,
// - restores from that copy if localStorage was ever cleared.
const DB = 'cardtellicence'; // original app name; kept so saved data stays readable
const STORE = 'kv';
export const PERSISTED_KEYS = ['ct-collection', 'ct-watch', 'ct-settings', 'ct-portfolio-history', 'ct-access-code'];

let dbPromise: Promise<IDBDatabase> | null = null;

// iOS home-screen apps sometimes never answer indexedDB.open(); never let that block anything.
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB timeout')), 2000);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => (clearTimeout(timer), resolve(req.result));
      req.onerror = () => (clearTimeout(timer), reject(req.error));
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  }).catch((e) => {
    dbPromise = null; // try again next time
    throw e;
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Mirror one key (called on every save). */
export function mirror(key: string, raw: string | null) {
  if (!PERSISTED_KEYS.includes(key) || typeof indexedDB === 'undefined') return;
  tx<unknown>('readwrite', (s) => (raw == null ? s.delete(key) : s.put({ raw, at: Date.now() }, key)) as IDBRequest<unknown>).catch(() => {});
}

/** On start: bring back anything localStorage lost, and mirror what only localStorage has. */
export async function restoreAndMirror(): Promise<string[]> {
  const restored: string[] = [];
  if (typeof indexedDB === 'undefined') return restored;
  for (const key of PERSISTED_KEYS) {
    try {
      const local = localStorage.getItem(key);
      const saved = await tx<{ raw: string; at: number } | undefined>('readonly', (s) => s.get(key));
      if (local == null && saved?.raw) {
        localStorage.setItem(key, saved.raw);
        restored.push(key);
      } else if (local != null && saved?.raw !== local) {
        mirror(key, local);
      }
    } catch {
      /* storage unavailable */
    }
  }
  return restored;
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export interface StorageStatus {
  installed: boolean; // opened from the home-screen icon
  persisted: boolean;
  usageKb: number | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let persisted = false;
  let usageKb: number | null = null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    usageKb = est?.usage != null ? Math.round(est.usage / 1024) : null;
  } catch {
    /* not supported */
  }
  return { installed, persisted, usageKb };
}
