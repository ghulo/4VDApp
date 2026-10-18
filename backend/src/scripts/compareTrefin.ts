/**
 * Run a VAT month next to TREFIN: read the month's documents from a fresh
 * TREFIN export and keep them beside 4VD's, for Books → "Next to
 * TREFIN". Changes nothing in the books; run it again with a newer export
 * at any time (explanations already given stay).
 *
 *   npm run compare:trefin -- <export folder> --month 2026-11
 *
 * On Render: 4vd-api -> Shell, with node dist/scripts/compareTrefin.js instead.
 */
import 'dotenv/config';
import path from 'node:path';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../database/connection.js';
import { TrefinCompareService } from '../services/vat/TrefinCompareService.js';
import { VatService } from '../services/vat/VatService.js';
import { vatResult } from '../services/vat/vatReturn.js';
import { logger } from '../utils/logger.js';
import { readTrefinVatMonth } from './trefinVat.js';

const euro = (value: number) => `€${value.toFixed(2)}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const monthAt = args.indexOf('--month');
  const month = monthAt === -1 ? undefined : args[monthAt + 1];
  const dir = args.find((arg, i) => !arg.startsWith('--') && i !== monthAt + 1);
  if (!dir || !month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    console.log('\nUsage: npm run compare:trefin -- <export folder> --month 2026-11\n');
    process.exit(1);
  }
  const items = readTrefinVatMonth(dir, month);
  const boxes = vatResult(items, 0, 0).boxes;
  const count = (kind: string) => items.filter((item) => item.kind === kind).length;
  console.log(`\nTREFIN, ${month}: ${count('till_day')} till days, ${count('invoice')} invoices, ${count('bill')} bills, ${count('credit')} supplier credits.`);
  console.log(`  VAT charged ${euro(boxes[30]!)}, VAT to claim back ${euro(boxes[67]!)}`);
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  try {
    await new TrefinCompareService(db, new VatService(db, config.shopTimeZone)).load(month, items, path.basename(path.resolve(dir)), null);
    console.log('Done. Open Books → Next to TREFIN to go through the differences.\n');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  logger.error('Loading the TREFIN month failed; nothing changed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
