import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { WIPED_AT_KEY } from '../repositories/LaunchRepository.js';

/** What has to be typed to really delete, so it can't happen by accident. */
export const WIPE_PHRASE = 'wipe 4vd.app';

/**
 * Tables emptied completely, in an order that respects their links
 * (children before the rows they point at).
 */
const EMPTIED = [
  'stock_count_lines',
  'expiry_dates',
  'purchase_order_lines',
  'purchase_orders',
  'suppliers',
  'stock_counts',
  'write_offs',
  'returns',
  'sales',
  'stock_adjustments',
  'bulk_pricing_tiers',
  'product_images',
  'favorites',
  'promotions',
  'carwash_days',
  'cash_counts',
  'expenses',
  'recurring_expenses',
  'tab_entries',
  'customers',
  'inventory',
  'products',
  'categories',
  'notifications',
  'activity_log',
  'invites',
  'email_outbox',
] as const;

export interface WipeReport {
  applied: boolean;
  /** The developer accounts that are kept (by email). */
  keptDevelopers: string[];
  /** Rows deleted (or that would be, on a dry run), by table. */
  deleted: Record<string, number>;
}

/**
 * Clear a shop's test data before launch: every product, sale, stock change,
 * request, alert and log entry, and every account except developers. Kept: the
 * developer accounts (with their sign-ins, devices and photo), the shop itself
 * and its settings. On a dry run nothing changes. Everything happens in one
 * transaction: all of it or none of it.
 */
export async function wipeShopData(db: DatabaseClient, options: { apply: boolean; actorId?: number }): Promise<WipeReport> {
  return db.transaction().execute(async (trx) => {
    const developers = await trx.selectFrom('users').select(['id', 'email']).where('role', '=', 'developer').execute();
    if (developers.length === 0) {
      throw new Error('There is no developer account to keep, so nothing was deleted (you would be locked out).');
    }
    const keep = developers.map((developer) => developer.id);

    const deleted: Record<string, number> = {};
    const countRows = async (query: ReturnType<typeof sql<{ n: string }>>) => Number((await query.execute(trx)).rows[0]?.n ?? 0);
    for (const table of EMPTIED) {
      deleted[table] = await countRows(sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`);
    }
    deleted.users = await countRows(sql<{ n: string }>`SELECT count(*) AS n FROM users WHERE id NOT IN (${sql.join(keep)})`);
    deleted.account_tokens = await countRows(
      sql<{ n: string }>`SELECT count(*) AS n FROM account_tokens WHERE user_id NOT IN (${sql.join(keep)})`,
    );

    if (options.apply) {
      for (const table of EMPTIED) await sql`DELETE FROM ${sql.table(table)}`.execute(trx);
      // Sessions, devices, Google links and favourites of removed people go with them (ON DELETE CASCADE).
      await sql`DELETE FROM account_tokens WHERE user_id NOT IN (${sql.join(keep)})`.execute(trx);
      await sql`DELETE FROM users WHERE id NOT IN (${sql.join(keep)})`.execute(trx);
      // Photos nobody uses any more (the kept developers' photos and the shop logo stay).
      const media = await sql`
        DELETE FROM media
        WHERE id NOT IN (SELECT avatar_media_id FROM users WHERE avatar_media_id IS NOT NULL)
          AND id NOT IN (SELECT logo_media_id FROM businesses WHERE logo_media_id IS NOT NULL)
      `.execute(trx);
      deleted.media = Number(media.numAffectedRows ?? 0n);
      // Ticks off "test data wiped" on the launch checklist.
      await sql`
        INSERT INTO settings (key, value, updated_at) VALUES (${WIPED_AT_KEY}, to_jsonb(now()::text), now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `.execute(trx);
      // The wipe empties the Activity page, so its own entry is the first thing on it afterwards.
      if (options.actorId !== undefined) {
        const rows = Object.values(deleted).reduce((sum, n) => sum + n, 0);
        await sql`
          INSERT INTO activity_log (user_id, action, entity_type, summary, details)
          VALUES (${options.actorId}, 'shop.wiped', 'settings', ${`Wiped all test data (${rows} rows); developer accounts, the shop details and settings were kept`}, ${JSON.stringify({ deleted })}::jsonb)
        `.execute(trx);
      }
    }

    return { applied: options.apply, keptDevelopers: developers.map((developer) => developer.email), deleted };
  });
}
