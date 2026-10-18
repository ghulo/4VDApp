/**
 * Bring TREFIN's balances over as the opening balances, for the day the books
 * start (Settings → Books). Fills the Opening balances page; nothing is posted
 * until a person confirms every line there. Can run again with a newer export
 * until then.
 *
 *   npm run opening:trefin -- <export folder>                              -> shows what it would do
 *   npm run opening:trefin -- <export folder> --confirm "bring balances"   -> does it
 *
 * On Render: 4vd-api -> Shell, with node dist/scripts/openingTrefin.js instead.
 */
import 'dotenv/config';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../database/connection.js';
import { BOOKS_START_KEY } from '../services/books/BooksPoster.js';
import { OpeningService } from '../services/OpeningService.js';
import { logger } from '../utils/logger.js';
import { openBills, readTrefinOpening } from './trefinOpening.js';

const PHRASE = 'bring balances';
const euro = (value: number) => `€${value.toFixed(2)}`;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--confirm');
  if (!dir) {
    console.log(`\nWhich folder? Usage: npm run opening:trefin -- <export folder> [--confirm "${PHRASE}"]\n`);
    process.exit(1);
  }
  const confirmAt = args.indexOf('--confirm');
  const apply = confirmAt !== -1 && args[confirmAt + 1] === PHRASE;
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  try {
    const start = await db.selectFrom('settings').select('value').where('key', '=', BOOKS_START_KEY).executeTakeFirst();
    if (typeof start?.value !== 'string') throw new Error('Set the day the books start first (Settings → Books).');
    const data = readTrefinOpening(dir, start.value);
    console.log(`\nTREFIN on the evening before ${data.day} (debits minus credits):`);
    for (const [number, amount] of data.accounts) console.log(`  ${number.padEnd(6)} ${euro(amount).padStart(14)}`);
    console.log(`  profit this year ${euro(-data.profitThisYear)}, in the years before ${euro(-data.profitEarlier)}`);
    const owing = [...data.suppliers].filter(([, balance]) => balance < 0);
    const bills = sum(
      owing.map(([code, balance]) => {
        const { bills: open, rest } = openBills(-balance, data.purchases.filter((purchase) => purchase.supplierCode === code));
        return open.length + (rest > 0 ? 1 : 0);
      }),
    );
    console.log(`  ${owing.length} suppliers are owed ${euro(-sum(owing.map(([, balance]) => balance)))} in ${bills} open bills`);
    const owed = [...data.customers.values()].filter((balance) => balance > 0);
    console.log(`  ${owed.length} customers owe ${euro(sum(owed))}`);
    if (data.off !== 0) console.log(`  TREFIN's books are off by ${euro(data.off)}; the difference ends up in owners' capital`);
    if (!apply) {
      console.log(`\nNothing changed. To bring it over, run again with: --confirm "${PHRASE}"\n`);
      return;
    }
    const result = await new OpeningService(db, config.shopTimeZone).loadTrefin(data, null);
    console.log(`\nDone: ${result.lines} lines, ${result.bills} open supplier bills, ${result.charges} customer balances.`);
    for (const item of result.skipped) console.log(`  left out: ${item.what} (${euro(item.amount)})`);
    console.log('Next: open Books → Opening balances, count the tills, type the bank balance, and confirm every line.\n');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  logger.error('Bringing the TREFIN balances over failed; nothing changed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
