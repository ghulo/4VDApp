import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import type { AssetCategory } from '../../database/types.js';
import { roundMoney } from '../../utils/money.js';
import { zonedDay } from '../../utils/zonedDates.js';

/**
 * How fixed assets wear out, in plain terms. Defaults until the accountant
 * confirms (handoff.md, step 12):
 *
 * - Straight-line: the same amount every month, a year's rate times the cost
 *   (less what it should still be worth at the end), divided by 12. The tax law
 *   (06/L-105) and the books use the same rates, so there is one schedule.
 * - Rates by kind: buildings 5%, furniture, equipment, vehicles and computers
 *   20%, machinery and anything else 10%, intangibles (software, licences) 20%
 *   (five years; the law allows up to 20). Land never wears out. Each asset can
 *   have its own rate.
 * - It starts the month after it is put to use and runs through the month it
 *   is sold or thrown away.
 * - A month is worked out once it is over (and at once for an asset sold in
 *   it). Its amounts are kept, so changing an asset only changes the months
 *   still to come. A month that falls in a closed year is caught up in the
 *   first open month after it.
 */
export const DEFAULT_RATES: Record<AssetCategory, number> = {
  furniture: 20,
  equipment: 20,
  vehicle: 20,
  building: 5,
  land: 0,
  intangible: 20,
  other: 10,
};

/** Under this, the tax rules let a purchase be a cost at once instead of an asset (to confirm with the accountant). */
export const SMALL_ASSET_LIMIT = 1000;

/** "2026-03-14" → "2026-03-01". */
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

/** The first day of the month `count` months after this one. */
export function addMonths(month: string, count: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + count;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-01`;
}

/** The month's last day. */
export const monthEnd = (month: string) => {
  const next = new Date(`${addMonths(month, 1)}T00:00:00Z`);
  return new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
};

export interface AssetBasis {
  category: AssetCategory;
  cost: number;
  residual: number;
  rate: number;
  openingDepreciated: number;
  inUseFrom: string;
  disposedOn: string | null;
}

/** What it can lose in all: its cost less what it should still be worth. */
export const depreciable = (asset: AssetBasis) => roundMoney(asset.cost - asset.residual);

/** A full month's depreciation; 0 for land or a rate of 0. */
export function monthlyAmount(asset: AssetBasis): number {
  if (asset.category === 'land' || asset.rate <= 0) return 0;
  return roundMoney((depreciable(asset) * asset.rate) / 1200);
}

/** The first month it wears out: the month after it was put to use. */
export const firstMonth = (asset: AssetBasis) => addMonths(monthStart(asset.inUseFrom), 1);

/** The last month to work out: through the month it left, else through `through`. */
export function lastMonth(asset: AssetBasis, through: string): string {
  if (asset.disposedOn === null) return through;
  return monthStart(asset.disposedOn);
}

/**
 * The months still to come and their amounts, from what is done so far: the
 * projection on an asset's page. Stops when it is worn out, it leaves, or
 * after `limit` months.
 */
export function projection(asset: AssetBasis, done: number, after: string, limit = 600): Array<{ month: string; amount: number }> {
  const monthly = monthlyAmount(asset);
  const months: Array<{ month: string; amount: number }> = [];
  if (monthly <= 0) return months;
  let left = roundMoney(depreciable(asset) - done);
  let month = addMonths(after, 1) < firstMonth(asset) ? firstMonth(asset) : addMonths(after, 1);
  const stop = asset.disposedOn ? monthStart(asset.disposedOn) : null;
  while (left > 0 && months.length < limit && (stop === null || month <= stop)) {
    const amount = Math.min(monthly, left);
    months.push({ month, amount });
    left = roundMoney(left - amount);
    month = addMonths(month, 1);
  }
  return months;
}

/** The last month that is over, in the shop's time zone. */
export const lastFinishedMonth = (now: Date, timeZone: string) => addMonths(monthStart(zonedDay(now, timeZone)), -1);

/** An asset with months to work out: its last worked-out month isn't the one it should reach. */
const dueSql = (through: string) =>
  sql<boolean>`filled_through is distinct from (case when disposed_on is not null then date_trunc('month', disposed_on)::date else ${through}::date end)`;

/** Whether any asset has a month to work out: one query, so the books can check on every read. */
export async function depreciationDue(db: DatabaseClient, timeZone: string, now = new Date()): Promise<boolean> {
  const row = await db
    .selectFrom('fixed_assets')
    .select('id')
    .where('voided_at', 'is', null)
    .where('place', '=', 'shop')
    .where(dueSql(lastFinishedMonth(now, timeZone)))
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Work out every month of depreciation that is due and not yet stored. Runs
 * inside the books' posting lock, before posting, so new months post with the
 * same sync.
 */
export async function fillDepreciation(db: DatabaseClient, startDay: string | null, timeZone: string, now = new Date()): Promise<number> {
  const through = lastFinishedMonth(now, timeZone);
  const assets = await db
    .selectFrom('fixed_assets')
    .select([
      'id',
      'category',
      'cost',
      'residual',
      'rate',
      'opening_depreciated',
      sql<string>`to_char(in_use_from, 'YYYY-MM-DD')`.as('in_use_from'),
      sql<string | null>`to_char(disposed_on, 'YYYY-MM-DD')`.as('disposed_on'),
    ])
    .where('voided_at', 'is', null)
    .where('place', '=', 'shop')
    .where(dueSql(through))
    .execute();
  if (assets.length === 0) return 0;

  const startMonth = startDay ? monthStart(startDay) : null;
  const closedYears = new Set((await db.selectFrom('book_years').select('year').execute()).map((row) => row.year));
  const monthIds = new Map<string, number>();
  const monthId = async (month: string) => {
    const known = monthIds.get(month);
    if (known !== undefined) return known;
    await sql`insert into depreciation_months (month) values (${month}::date) on conflict (month) do nothing`.execute(db);
    const row = await db.selectFrom('depreciation_months').select('id').where('month', '=', month).executeTakeFirstOrThrow();
    monthIds.set(month, row.id);
    return row.id;
  };

  let added = 0;
  for (const row of assets) {
    const asset: AssetBasis = {
      category: row.category,
      cost: Number(row.cost),
      residual: Number(row.residual),
      rate: Number(row.rate),
      openingDepreciated: Number(row.opening_depreciated),
      inUseFrom: row.in_use_from,
      disposedOn: row.disposed_on,
    };
    const last = lastMonth(asset, through);
    const lines = await db
      .selectFrom('depreciation_lines as l')
      .innerJoin('depreciation_months as m', 'm.id', 'l.month_id')
      .select([sql<string>`to_char(m.month, 'YYYY-MM-DD')`.as('month'), 'l.amount'])
      .where('l.asset_id', '=', row.id)
      .execute();
    const stored = new Set(lines.map((line) => line.month));
    let done = roundMoney(asset.openingDepreciated + lines.reduce((sum, line) => sum + Number(line.amount), 0));
    const monthly = monthlyAmount(asset);
    let carry = 0;
    let month = firstMonth(asset);
    if (startMonth && month < startMonth) month = startMonth;
    while (monthly > 0 && month <= last) {
      const left = roundMoney(depreciable(asset) - done);
      if (left <= 0) break;
      if (!stored.has(month)) {
        const amount = Math.min(monthly, left);
        done = roundMoney(done + amount);
        if (closedYears.has(Number(month.slice(0, 4)))) carry = roundMoney(carry + amount);
        else {
          await db.insertInto('depreciation_lines').values({ month_id: await monthId(month), asset_id: row.id, amount: roundMoney(amount + carry) }).execute();
          carry = 0;
          added += 1;
        }
      }
      month = addMonths(month, 1);
    }
    await db.updateTable('fixed_assets').set({ filled_through: last }).where('id', '=', row.id).execute();
  }
  return added;
}
