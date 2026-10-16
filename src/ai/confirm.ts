// Actions the assistant proposes wait here until the user taps confirm or decline.
const pending = new Map<string, (ok: boolean) => void>();
const decided = new Map<string, boolean>();
const EVENT = 'ct-ai-confirm';

export function requestConfirmation(toolUseId: string): Promise<boolean> {
  return new Promise((resolve) => {
    pending.set(toolUseId, resolve);
    window.dispatchEvent(new Event(EVENT));
  });
}

export function answerConfirmation(toolUseId: string, ok: boolean) {
  pending.get(toolUseId)?.(ok);
  pending.delete(toolUseId);
  decided.set(toolUseId, ok);
  window.dispatchEvent(new Event(EVENT));
}

/** Decline everything still open (conversation stopped or reset). */
export function declineAll() {
  for (const id of [...pending.keys()]) answerConfirmation(id, false);
}

export const isPending = (id: string) => pending.has(id);
export const decision = (id: string) => decided.get(id);
export const CONFIRM_EVENT = EVENT;
