/**
 * Bring the market over from TREFIN, the old till software (see trefinImport).
 * Run it once, on a wiped shop, pointing at the export folder.
 *
 *   npm run import:trefin -- <export folder>                             -> checks everything, changes nothing
 *   npm run import:trefin -- <export folder> --confirm "import trefin"   -> imports it
 *
 * On Render: 4vd-api -> Shell, with node dist/scripts/importTrefin.js instead.
 */
import 'dotenv/config';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { IMPORT_PHRASE, importTrefin, readTrefinExport } from './trefinImport.js';

function confirmed(argv: string[]): boolean {
  const index = argv.indexOf('--confirm');
  return index !== -1 && argv[index + 1] === IMPORT_PHRASE;
}

async function main(): Promise<void> {
  const dir = process.argv.slice(2).find((arg, i, args) => !arg.startsWith('--') && args[i - 1] !== '--confirm');
  if (!dir) {
    console.log('\nWhich folder? Usage: npm run import:trefin -- <export folder> [--confirm "import trefin"]\n');
    process.exit(1);
  }
  const apply = confirmed(process.argv);
  const config = loadConfig();
  const data = readTrefinExport(dir);
  const db = createDatabase(config.databaseUrl);
  try {
    const started = Date.now();
    const report = await importTrefin(db, data, { apply, timeZone: config.shopTimeZone });
    const { created } = report;
    console.log(apply ? '\nImported:' : '\nWould import (checked against the database, nothing has changed yet):');
    console.log(`  categories       ${created.categories}  (new)`);
    console.log(`  products         ${created.products}`);
    console.log(`  suppliers        ${created.suppliers}`);
    console.log(`  customers        ${created.customers}`);
    console.log(`  sale lines       ${created.sales}  (${created.checkouts} receipts, ${report.firstSale} to ${report.lastSale}, €${report.revenue.toFixed(2)})`);
    console.log(`  duplicate pairs  ${created.duplicateFlags}  (to review)`);
    console.log(`  old products     ${created.oldProducts}  (inactive: an older database's code later went to another product)`);
    console.log(`  bills            ${created.bills}  (${created.billLines} lines, ${created.deletedBills} deleted in TREFIN; to look at only)`);
    console.log(`  invoices         ${created.invoices}  (TREFIN's own, over its sales; to look at only)`);
    console.log(`  deleted receipts ${created.deletedReceipts}  (deleted in TREFIN; in Reports → Counter)`);
    console.log(`  stock documents  ${created.stockDocuments}  (${created.stockLines} lines: starting stock, corrections, counts; in Stock counts)`);
    console.log('\nWorth knowing:');
    for (const [what, n] of Object.entries(report.notes)) console.log(`  ${String(n).padStart(6)}  ${what}`);
    console.log(`\nTook ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    if (!apply) console.log(`To really import it, run again with: --confirm "${IMPORT_PHRASE}"\n`);
    else console.log('Done. Count the stock next: most TREFIN stock figures were never counted.\n');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  logger.error('TREFIN import failed; nothing was imported', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
