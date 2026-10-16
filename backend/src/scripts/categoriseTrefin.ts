/**
 * Sort TREFIN's products into real categories before the import (TREFIN kept
 * them all in one). Claude reads each product's name, unit and price and picks
 * one of MARKET_CATEGORIES; the answers go to categories.csv in the export
 * folder, where they can be checked and corrected in Excel. The import then
 * uses that file. Products already in the file are skipped, so a stopped run
 * picks up where it left off, and hand corrections are kept.
 *
 *   npm run categorise:trefin -- <export folder>
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { loadConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { CATEGORIES_FILE, MARKET_CATEGORIES, parseCsv, readCategoryFile } from './trefinImport.js';

const MODEL = 'claude-opus-5-5';
const BATCH = 150;
const PARALLEL = 4;

const answerSchema = z.object({
  products: z.array(z.object({ code: z.string(), category: z.enum(MARKET_CATEGORIES) })),
});

const INSTRUCTIONS = `You sort the products of a small mini-market in Kosovo into categories.
Names are mostly Albanian, often with brand names, sizes and typos (Uje = water, Birre = beer, Qumesht = milk, Buke = bread, Sapun = soap, Kanaqe = can).
For every product given, return its code and exactly one category from the list. Pick the category a shopper would look for it in.
- Cigarettes, tobacco, vapes, cigarette paper, lighters: "Cigare dhe duhan".
- Plain and mineral water: "Ujë". Energy drinks (Red Bull, Golden Eagle, XL...): "Pije energjike". Other soft drinks, juices, iced tea: "Pije freskuese".
- Beer, wine, spirits: "Alkool". Coffee, tea, cocoa drinks, iced coffee: "Kafe dhe çaj".
- Chocolate, candy, gum, jelly sweets: "Çokollata dhe ëmbëlsira". Biscuits, wafers, croissants, cakes: "Biskota dhe kek". Chips, crackers, nuts, seeds, popcorn: "Çipsa dhe fara".
- Furniture, garden, tools, kitchenware, plastic goods, decorations, toys: "Shtëpi dhe kopsht". Cables, chargers, batteries, phone accessories: "Elektronikë".
Use "Të ndryshme" only when the name gives you nothing to go on.`;

function toCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.log('\nWhich folder? Usage: npm run categorise:trefin -- <export folder>\n');
    process.exit(1);
  }
  const ai = loadConfig().ai;
  if (ai?.provider !== 'anthropic') throw new Error('ANTHROPIC_API_KEY is not set in backend/.env.');
  const client = new Anthropic({
    apiKey: ai.apiKey,
    ...(ai.workspaceId && { defaultHeaders: { 'anthropic-workspace-id': ai.workspaceId } }),
  });

  const file = path.join(dir, CATEGORIES_FILE);
  const done = readCategoryFile(dir);
  const products = parseCsv(fs.readFileSync(path.join(dir, 'products.csv'), 'utf8'));
  const names = new Map(products.map((p) => [p.product_code!.trim(), p.name!.replace(/\s+/g, ' ').trim()]));
  const todo = products.filter((p) => !done.has(p.product_code!.trim()));
  if (!fs.existsSync(file)) fs.writeFileSync(file, '﻿product_code,name,category\n');
  console.log(`\n${done.size} products already sorted, ${todo.length} to go.`);

  const batches: Array<typeof todo> = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  let next = 0;
  let input = 0;
  let output = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      const list = batch.map((p) => `${p.product_code!.trim()} | ${names.get(p.product_code!.trim())} | ${p.unit} | €${p.sale_price_incl_vat}`).join('\n');
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 16_000,
        system: INSTRUCTIONS,
        messages: [{ role: 'user', content: `Categories: ${MARKET_CATEGORIES.join('; ')}\n\nProducts (code | name | unit | price):\n${list}` }],
        output_config: { format: zodOutputFormat(answerSchema), effort: 'low' },
      });
      input += response.usage.input_tokens;
      output += response.usage.output_tokens;
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        logger.warn('Claude did not sort a batch; run again to retry it', { first: batch[0]!.product_code });
        continue;
      }
      const wanted = new Set(batch.map((p) => p.product_code!.trim()));
      const rows = response.parsed_output.products.filter((row) => wanted.has(row.code) && !done.has(row.code));
      for (const row of rows) done.set(row.code, row.category);
      fs.appendFileSync(file, rows.map((row) => [row.code, names.get(row.code) ?? '', row.category].map(toCsvField).join(',')).join('\n') + (rows.length ? '\n' : ''));
      console.log(`  ${done.size}/${products.length} sorted`);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const counts = new Map<string, number>();
  for (const category of done.values()) counts.set(category, (counts.get(category) ?? 0) + 1);
  console.log('\nBy category:');
  for (const [category, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${category}`);
  const missing = products.length - done.size;
  console.log(`\n${missing === 0 ? 'Every product is sorted.' : `${missing} not sorted yet; run again.`} Tokens: ${input} in, ${output} out.`);
  console.log(`Check ${file} (fix any row in Excel), then run the import.\n`);
}

main().catch((error: unknown) => {
  logger.error('Sorting failed; what was sorted so far is kept', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
