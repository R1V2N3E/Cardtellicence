// Resolves the Cardmarket product of a Japanese card and its current EUR prices.
// Product id: TCGdex mapping first, else positional name mapping of the whole set.
// Prices: Cardmarket's official daily price guide, else TCGdex's copy of it.
import { mapSetByNames, officialPrices } from './cardmarket.js';
import { cached } from './http.js';
import { englishName } from './pokedex.js';
import { cardmarketFromRaw, cardmarketUrl, getRawCard, getSet } from './tcgdex.js';
import type { CardmarketPrices } from './types.js';

type RawCard = Awaited<ReturnType<typeof getRawCard>>;

export function setProductMap(setId: string): Promise<Map<string, number>> {
  return cached(`cm:setmap:${setId}`, 12 * 3600_000, async () => {
    const set = await getSet(setId);
    const cards = set.cards.map((c) => ({ localId: c.localId, nameEn: englishName(c.name, []) }));
    return mapSetByNames(cards, set.releaseDate ?? null);
  });
}

export async function cardmarketFor(raw: RawCard): Promise<(CardmarketPrices & { matched: 'tcgdex' | 'name' }) | null> {
  const fromTcgdex = cardmarketFromRaw(raw);
  let idProduct = fromTcgdex?.idProduct ?? null;
  let matched: 'tcgdex' | 'name' = 'tcgdex';
  if (!idProduct) {
    idProduct = (await setProductMap(raw.set.id).catch(() => new Map<string, number>())).get(raw.localId) ?? null;
    matched = 'name';
  }
  if (!idProduct) return null;
  const url = cardmarketUrl(idProduct, raw);
  const official = await officialPrices(idProduct, url).catch(() => null);
  if (official) return { ...official, matched };
  return fromTcgdex?.trend ? { ...fromTcgdex, matched } : null;
}
