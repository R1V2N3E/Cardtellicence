// Where to check German selling prices. eBay.de and Kleinanzeigen block automated requests
// (and eBay's API has no sold prices), so the app links straight to the right searches.
import { germanName } from './pokedex.js';
import type { CardDetail } from './types.js';

export interface SellLinks {
  query: string;
  ebaySold: string;
  ebayLive: string;
  kleinanzeigen: string;
}

export function sellLinks(card: Pick<CardDetail, 'nameJa' | 'nameEn' | 'number' | 'dexId'>): SellLinks {
  const de = germanName(card.nameJa, card.dexId);
  const name = de ?? card.nameEn ?? card.nameJa;
  const num = card.number.split('/')[0];
  // eBay: name + number + "japanisch" finds the Japanese printing among listings.
  const query = `${name} ${num} japanisch`;
  const q = encodeURIComponent(query);
  const kaSlug = `${name} ${num} japanisch`.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '');
  return {
    query,
    ebaySold: `https://www.ebay.de/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_sop=13`,
    ebayLive: `https://www.ebay.de/sch/i.html?_nkw=${q}&_sop=15`,
    kleinanzeigen: `https://www.kleinanzeigen.de/s-${kaSlug}/k0`,
  };
}
