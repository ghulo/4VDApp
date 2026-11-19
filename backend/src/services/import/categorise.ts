import { z } from 'zod';
import { MARKET_CATEGORIES } from '../../scripts/trefinImport.js';
import type { AiProvider } from '../ai/aiProvider.js';
import { OTHER_CATEGORY } from './analyse.js';

/**
 * Sorting imported products into categories when the file has none (TREFIN
 * keeps every product in "Të ndryshme"). The AI picks one of the business's
 * own categories when it has at least five, else one of 4VD's market
 * categories. Without an AI, or when it fails, products stay in
 * "Të ndryshme", and the preview says so.
 */

const BATCH = 150;
const PARALLEL = 4;
/** With fewer than this many of its own categories, a business gets 4VD's market list. */
const OWN_ENOUGH = 5;

const INSTRUCTIONS = `You sort the products of a small shop in Kosovo into categories.
Names are mostly Albanian, often with brand names, sizes and typos (Uje = water, Birre = beer, Qumesht = milk, Buke = bread, Sapun = soap, Kanaqe = can).
For every product given, return its key and exactly one category from the list, written exactly as in the list. Pick the category a shopper would look for it in.
Use "${OTHER_CATEGORY}" only when the name gives you nothing to go on.`;

export function categoryList(own: string[]): string[] {
  const names = own.filter((name) => name.trim() !== '');
  if (names.length >= OWN_ENOUGH) return names.includes(OTHER_CATEGORY) ? names : [...names, OTHER_CATEGORY];
  return [...MARKET_CATEGORIES];
}

/**
 * key → category for each product. Keys are what the caller uses to find the
 * product again (its code, else its row). `onProgress` gets how many are sorted.
 */
export async function categorise(
  provider: AiProvider | null,
  products: Array<{ key: string; name: string }>,
  categories: string[],
  onProgress?: (done: number) => void,
): Promise<{ guesses: Record<string, string>; sorted: boolean }> {
  const guesses: Record<string, string> = {};
  if (!provider || products.length === 0) return { guesses, sorted: false };
  const allowed = new Set(categories);
  const schema = z.object({ products: z.array(z.object({ key: z.string(), category: z.string() })) });
  const batches: Array<Array<{ key: string; name: string }>> = [];
  for (let i = 0; i < products.length; i += BATCH) batches.push(products.slice(i, i + BATCH));
  let failed = 0;
  let done = 0;
  const worker = async () => {
    for (let batch = batches.shift(); batch; batch = batches.shift()) {
      const wanted = new Set(batch.map((p) => p.key));
      try {
        const answer = await provider.generateJson(
          {
            instructions: INSTRUCTIONS,
            request: `Categories: ${categories.join('; ')}\n\nProducts (key | name):\n${batch.map((p) => `${p.key} | ${p.name}`).join('\n')}`,
          },
          schema,
        );
        for (const row of answer.products) if (wanted.has(row.key) && allowed.has(row.category)) guesses[row.key] = row.category;
      } catch {
        failed++;
      }
      done += batch.length;
      onProgress?.(done);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { guesses, sorted: failed === 0 || Object.keys(guesses).length > 0 };
}
