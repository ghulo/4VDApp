export interface Searchable {
  label: string;
  /** Extra words that should find it, e.g. a SKU or "discounts" for Promotions. */
  keywords?: string;
}

/** Lower case without accents, so "kovac" finds "Kovač". */
function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Items whose text contains every word of the query, best first: a word that
 * starts with what was typed beats one that merely contains it, and the label
 * beats the keywords. Ties keep their original order.
 */
export function rankMatches<T extends Searchable>(query: string, items: T[]): T[] {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;

  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const label = normalise(item.label);
    const all = `${label} ${normalise(item.keywords ?? '')}`;
    if (!words.every((word) => all.includes(word))) return;
    const labelWords = label.split(/[\s\-_/]+/);
    let score = 0;
    for (const word of words) {
      if (labelWords.some((labelWord) => labelWord.startsWith(word))) score += 3;
      else if (label.includes(word)) score += 2;
      else score += 1;
    }
    scored.push({ item, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.item);
}

/** Whether a key press belongs to a field the person is typing in. */
export function isTypingTarget(target: { tagName: string; isContentEditable: boolean } | null): boolean {
  if (!target) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
