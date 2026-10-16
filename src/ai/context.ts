// What the assistant should know about the moment a question is asked: date, the page the user
// came from, saved preferences and the cost settings. Sent inside the user's message.
import { loadOpportunities } from '../api';
import { CHANNEL } from '../margin';
import { readList, readSettings, type CollectionItem } from '../state';
import { readMemory } from './store';

/** "card:SV2a-201", "set:SV4M", "portfolio", "deals", "market" … */
export type AiContext = string | null;

export async function contextText(ctx: AiContext): Promise<string> {
  const s = readSettings();
  const lines = [
    `Datum: ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
    `Einstellungen: Kauf über ${s.buySource}, Verkauf über ${CHANNEL[s.sellChannel].label}, Netto-Rechnung ${s.net ? 'an' : 'aus'}, Portfolio-Bewertung ${s.valuation}.`,
    `Sammlung: ${readList<CollectionItem>('ct-collection').reduce((n, c) => n + c.qty, 0)} Stück.`,
  ];
  if (ctx?.startsWith('card:')) {
    const id = ctx.slice(5);
    const o = await loadOpportunities()
      .then((d) => d.items.find((x) => x.id === id) ?? d.sealed?.find((x) => x.id === id))
      .catch(() => undefined);
    lines.push(`Der Nutzer schaut gerade auf die Karte ${id}${o ? ` (${'nameEn' in o && o.nameEn ? o.nameEn : ''} ${'nameJa' in o ? o.nameJa : ''})` : ''}. "Diese Karte" meint sie.`);
  } else if (ctx?.startsWith('set:')) lines.push(`Der Nutzer schaut gerade auf das Set ${ctx.slice(4)} in der Marktanalyse.`);
  else if (ctx === 'portfolio') lines.push('Der Nutzer kommt aus seinem Portfolio.');
  else if (ctx === 'deals') lines.push('Der Nutzer kommt aus der Deals-Liste (Kauf Japan → Verkauf Deutschland).');
  else if (ctx === 'market') lines.push('Der Nutzer kommt aus der Marktanalyse.');
  const mem = readMemory();
  if (mem.length) lines.push('Gespeicherte Vorlieben des Nutzers:', ...mem.map((m) => `- ${m.text}`));
  return `<app_kontext>\n${lines.join('\n')}\n</app_kontext>`;
}
