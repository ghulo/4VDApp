import { sql } from 'kysely';
import { ACCOUNT_LINK_KEYS, type AccountLinkKey } from '../../constants/chartOfAccounts.js';
import type { DatabaseClient } from '../../database/connection.js';
import { type AccountLinks, type DraftEntry, fingerprintOf } from './entryBuilder.js';
import { ensurePlaces } from '../../database/places.js';
import { checkoutKeySql, loadPlaceAccounts, PostingRules } from './postingRules.js';

/** Any number, shared by every server: only one of them posts at a time. */
const POSTING_LOCK = 40_839;
/** Queue rows taken per round. */
const BATCH = 5_000;

/** The source key each changed row of these tables posts as, besides sales (which group into checkouts). */
const DIRECT_SOURCES: Record<string, string> = {
  returns: 'return',
  write_offs: 'write_off',
  stock_count_lines: 'count_line',
  stock_adjustments: 'adjustment',
  supplier_payments: 'payment',
  expenses: 'expense',
  money_moves: 'move',
};

export const BOOKS_START_KEY = 'books_start';

/**
 * Brings the books up to date with the documents. The posting tables' trigger
 * queues every changed row; this turns the queue into the documents it touches
 * and checks each one's entry: unchanged, it stays; changed or gone, the old
 * entry is reversed and the right one written.
 */
export class BooksPoster {
  constructor(
    private readonly db: DatabaseClient,
    private readonly timeZone: string,
  ) {}

  async startDay(db: DatabaseClient = this.db): Promise<string | null> {
    const row = await db.selectFrom('settings').select('value').where('key', '=', BOOKS_START_KEY).executeTakeFirst();
    return typeof row?.value === 'string' ? row.value : null;
  }

  async links(db: DatabaseClient = this.db): Promise<AccountLinks> {
    const rows = await db.selectFrom('ledger_links').select(['key', 'account_id']).execute();
    const links = Object.fromEntries(rows.map((row) => [row.key, row.account_id])) as Partial<AccountLinks>;
    const missing = ACCOUNT_LINK_KEYS.filter((key: AccountLinkKey) => links[key] === undefined);
    if (missing.length > 0) throw new Error(`The books have no account for: ${missing.join(', ')}`);
    return links as AccountLinks;
  }

  /** Post everything waiting. Safe to call often: with nothing queued it costs one query. */
  async sync(): Promise<void> {
    const waiting = await this.db.selectFrom('ledger_queue').select('row_id').limit(1).executeTakeFirst();
    if (!waiting) return;
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${POSTING_LOCK})`.execute(trx);
      await ensurePlaces(trx as never);
      const rules = new PostingRules(trx, await this.links(trx), await loadPlaceAccounts(trx), this.timeZone, await this.startDay(trx));
      for (;;) {
        const taken = await sql<{ source_table: string; row_id: number }>`
          delete from ledger_queue where (source_table, row_id) in (select source_table, row_id from ledger_queue limit ${BATCH})
          returning source_table, row_id
        `.execute(trx);
        if (taken.rows.length === 0) break;
        for (const key of await this.sourceKeys(trx, taken.rows, await this.startDay(trx))) {
          await this.post(trx, key, await rules.draft(key));
        }
      }
    });
  }

  /**
   * Throw away every entry 4VD wrote and post again from the books' first day:
   * after the first day changes. Manual entries stay.
   */
  async rebuild(): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${POSTING_LOCK})`.execute(trx);
      await sql`delete from ledger_entries where kind = 'reversal' and source_key is not null`.execute(trx);
      await sql`delete from ledger_entries where kind = 'auto'`.execute(trx);
      const start = (await this.startDay(trx)) ?? '0001-01-01';
      const tz = this.timeZone;
      await sql`
        insert into ledger_queue (source_table, row_id)
        select 'sales', id from sales where (sale_date at time zone ${tz})::date >= ${start}::date
        union all select 'returns', id from returns where decided_at is not null
        union all select 'write_offs', id from write_offs where decided_at is not null
        union all select 'stock_count_lines', id from stock_count_lines where decided_at is not null
        union all select 'stock_adjustments', id from stock_adjustments where reason = 'Manual adjustment'
        union all select 'supplier_bills', id from supplier_bills where issued_on >= ${start}::date and trefin_ref is null
        union all select 'supplier_payments', id from supplier_payments where paid_on >= ${start}::date
        union all select 'tab_entries', id from tab_entries where kind = 'payment'
        union all select 'money_moves', id from money_moves where day >= ${start}::date
        on conflict do nothing
      `.execute(trx);
    });
    await this.sync();
  }

  /** The documents a batch of changed rows touches, as source keys. */
  private async sourceKeys(db: DatabaseClient, rows: Array<{ source_table: string; row_id: number }>, startDay: string | null): Promise<string[]> {
    const keys = new Set<string>();
    const ids = (table: string) => rows.filter((row) => row.source_table === table).map((row) => row.row_id);

    const billIds = ids('supplier_bills');
    for (const id of billIds) keys.add(`bill:${id}`);
    if (billIds.length > 0) {
      // A bill's supplier shows on its payments' entries too.
      const payments = await db.selectFrom('supplier_payments').select('id').where('bill_id', 'in', billIds).execute();
      for (const payment of payments) keys.add(`payment:${payment.id}`);
    }

    // After the bills, so a bill's entry comes before its payments'.
    for (const [table, kind] of Object.entries(DIRECT_SOURCES)) for (const id of ids(table)) keys.add(`${kind}:${id}`);

    const saleIds = new Set(ids('sales'));
    const tabIds = ids('tab_entries');
    for (const id of tabIds) keys.add(`tab_payment:${id}`);
    if (tabIds.length > 0) {
      const tabRows = await db.selectFrom('tab_entries').select(['sale_id', 'return_id']).where('id', 'in', tabIds).execute();
      for (const row of tabRows) {
        if (row.sale_id !== null) saleIds.add(row.sale_id);
        if (row.return_id !== null) keys.add(`return:${row.return_id}`);
      }
    }
    if (saleIds.size > 0) {
      // The checkout each sale is in now, plus every checkout it could have been in before
      // (alone, or on an earlier invoice), so a moved sale leaves its old entry.
      const { rows: saleKeys } = await sql<{ key: string }>`
        select ${checkoutKeySql(this.timeZone)} as key from sales s
        where s.id = any(${[...saleIds]}::int[]) and (${startDay}::date is null or (s.sale_date at time zone ${this.timeZone})::date >= ${startDay}::date)
        union select 's' || s.id from sales s
        where s.id = any(${[...saleIds]}::int[]) and exists (select 1 from ledger_entries e where e.source_key = 'checkout:s' || s.id)
        union select distinct 'i' || dl.document_id from document_lines dl join documents d on d.id = dl.document_id
        where dl.sale_id = any(${[...saleIds]}::int[]) and d.kind = 'invoice'
          and exists (select 1 from ledger_entries e where e.source_key = 'checkout:i' || dl.document_id)
      `.execute(db);
      for (const row of saleKeys) keys.add(`checkout:${row.key}`);
    }
    return [...keys];
  }

  /** Make a document's entry match what it should be: leave it, reverse it, and/or write the new one. */
  private async post(db: DatabaseClient, sourceKey: string, draft: DraftEntry | null): Promise<void> {
    const current = await db
      .selectFrom('ledger_entries')
      .select(['id', 'fingerprint', 'description'])
      .where('source_key', '=', sourceKey)
      .where('kind', '=', 'auto')
      .where('reversed_at', 'is', null)
      .executeTakeFirst();
    const fingerprint = draft ? fingerprintOf(draft) : null;
    if (current && current.fingerprint === fingerprint) {
      if (draft && current.description !== draft.description) {
        await db.updateTable('ledger_entries').set({ description: draft.description, warning: draft.warning }).where('id', '=', current.id).execute();
      }
      return;
    }
    if (current) await reverseEntry(db, current.id, null, sourceKey);
    if (draft) {
      const entry = await db
        .insertInto('ledger_entries')
        .values({ entry_date: draft.date, kind: 'auto', source_key: sourceKey, description: draft.description, warning: draft.warning, fingerprint })
        .returning('id')
        .executeTakeFirstOrThrow();
      await insertLines(db, entry.id, draft.lines);
    }
  }
}

export async function insertLines(db: DatabaseClient, entryId: number, lines: DraftEntry['lines'], memos: Array<string | null> = []): Promise<void> {
  await db
    .insertInto('ledger_lines')
    .values(
      lines.map((line, index) => ({
        entry_id: entryId,
        account_id: line.accountId,
        debit: line.debit,
        credit: line.credit,
        supplier_id: line.supplierId,
        customer_id: line.customerId,
        memo: memos[index] ?? null,
      })),
    )
    .execute();
}

/**
 * Cancel an entry with its mirror image on the same day: every debit becomes a
 * credit. The entry stays in the books, marked reversed.
 */
export async function reverseEntry(db: DatabaseClient, id: number, by: number | null, sourceKey: string | null): Promise<number> {
  const original = await db.selectFrom('ledger_entries').select([sql<string>`to_char(entry_date, 'YYYY-MM-DD')`.as('entry_date'), 'description']).where('id', '=', id).executeTakeFirstOrThrow();
  const lines = await db.selectFrom('ledger_lines').selectAll().where('entry_id', '=', id).orderBy('id').execute();
  await db.updateTable('ledger_entries').set({ reversed_at: new Date() }).where('id', '=', id).execute();
  const reversal = await db
    .insertInto('ledger_entries')
    .values({ entry_date: original.entry_date, kind: 'reversal', source_key: sourceKey, description: original.description, reverses_id: id, created_by: by })
    .returning('id')
    .executeTakeFirstOrThrow();
  await insertLines(
    db,
    reversal.id,
    lines.map((line) => ({
      accountId: line.account_id,
      debit: Number(line.credit),
      credit: Number(line.debit),
      supplierId: line.supplier_id,
      customerId: line.customer_id,
    })),
    lines.map((line) => line.memo),
  );
  return reversal.id;
}
