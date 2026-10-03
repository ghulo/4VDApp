/**
 * Clear the shop's test data before launch, keeping only developer accounts,
 * the shop and its settings (see wipeShopData).
 *
 *   node dist/scripts/wipe.js                            -> shows what would be deleted, changes nothing
 *   node dist/scripts/wipe.js --confirm "wipe 4vd.app"   -> deletes it
 *
 * On Render: 4vd-api -> Shell. In development: npm run wipe -- --confirm "wipe 4vd.app".
 */
import 'dotenv/config';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { WIPE_PHRASE, wipeShopData } from './wipeShopData.js';

function confirmed(argv: string[]): boolean {
  const index = argv.indexOf('--confirm');
  return index !== -1 && argv[index + 1] === WIPE_PHRASE;
}

async function main(): Promise<void> {
  const apply = confirmed(process.argv);
  const db = createDatabase(loadConfig().databaseUrl);
  try {
    const report = await wipeShopData(db, { apply });
    const rows = Object.entries(report.deleted).filter(([, n]) => n > 0);
    console.log(`\nKept developer account(s): ${report.keptDevelopers.join(', ')}`);
    console.log(apply ? '\nDeleted:' : '\nWould delete (nothing has changed yet):');
    for (const [table, n] of rows) console.log(`  ${table.padEnd(20)} ${n}`);
    if (rows.length === 0) console.log('  nothing, the shop is already empty');
    if (!apply) console.log(`\nTo really delete it, run again with: --confirm "${WIPE_PHRASE}"\n`);
    else console.log('\nDone. The shop is empty except for the accounts above, its details and settings.\n');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  logger.error('Wipe failed; nothing was deleted', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
