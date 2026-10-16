// What the assistant keeps on this device: the current conversation, facts the user asked it to
// remember, and price alerts.
import type Anthropic from '@anthropic-ai/sdk';
import { readList, useStored, write } from '../state';

export type ApiMessage = Anthropic.Beta.BetaMessageParam;

// ---- conversation ----
const CHAT = 'ct-ai-chat';
export const readChat = () => readList<ApiMessage>(CHAT);
export function writeChat(messages: ApiMessage[]) {
  try {
    localStorage.setItem(CHAT, JSON.stringify(messages));
  } catch {
    // Too large for storage (photos, long chats): keep the conversation in memory only.
  }
}
export const clearChat = () => writeChat([]);

// ---- memory ----
export interface MemoryFact {
  id: string;
  text: string;
  at: string;
}
export const readMemory = () => readList<MemoryFact>('ct-ai-memory');
export const useMemory = () => useStored<MemoryFact[]>('ct-ai-memory', readMemory);
export const addMemory = (text: string) => write('ct-ai-memory', [...readMemory(), { id: crypto.randomUUID(), text, at: new Date().toISOString() }].slice(-40));
export const removeMemory = (id: string) => write('ct-ai-memory', readMemory().filter((m) => m.id !== id));

// ---- price alerts ----
export interface PriceAlert {
  id: string;
  cardId: string;
  name: string;
  belowEur?: number | null;
  aboveEur?: number | null;
  crBuyAboveJpy?: number | null;
  createdAt: string;
  triggeredAt?: string | null;
  lastSeen?: { eur: number | null; crBuyJpy: number | null } | null;
}
export const readAlerts = () => readList<PriceAlert>('ct-alerts');
export const useAlerts = () => useStored<PriceAlert[]>('ct-alerts', readAlerts);
export const addAlert = (a: Omit<PriceAlert, 'id' | 'createdAt'>) =>
  write('ct-alerts', [{ ...a, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...readAlerts()]);
export const removeAlert = (id: string) => write('ct-alerts', readAlerts().filter((a) => a.id !== id));
export const saveAlerts = (list: PriceAlert[]) => write('ct-alerts', list);

export function alertText(a: PriceAlert): string {
  const parts = [
    a.belowEur != null && `unter ${a.belowEur.toLocaleString('de-DE')} €`,
    a.aboveEur != null && `über ${a.aboveEur.toLocaleString('de-DE')} €`,
    a.crBuyAboveJpy != null && `Card-Rush-Ankauf über ¥${a.crBuyAboveJpy.toLocaleString('de-DE')}`,
  ].filter(Boolean);
  return parts.join(' oder ');
}
