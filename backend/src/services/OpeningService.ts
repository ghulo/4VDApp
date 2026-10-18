import { sql } from 'kysely';
import { type AccountClass, DEBIT_CLASSES } from '../constants/chartOfAccounts.js';
import type { DatabaseClient } from '../database/connection.js';
import type { OpeningLineKind, OpeningSource } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import { BooksRepository } from '../repositories/BooksRepository.js';
import { VatMonthRepository } from '../repositories/VatMonthRepository.js';
import { openBills, type TrefinOpening } from '../scripts/trefinOpening.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { startOfDay } from '../utils/zonedDates.js';
import { ensurePlaces } from '../database/places.js';
import { BOOKS_START_KEY, insertLines, reverseEntry } from './books/BooksPoster.js';
import { assertMonthsOpen } from './vat/periodLock.js';

export const OPENING_POSTED_KEY = 'opening_posted';
export const OPENING_TREFIN_KEY = 'opening_trefin_loaded';

/** Which kinds of line a person types; the others are worked out from stock, bills and tabs. */
const TYPED_KINDS: OpeningLineKind[] = ['place', 'account'];
/** Where a typed figure came from, as a person can say it. */
export const TYPED_SOURCES = ['counted', 'statement', 'trefin', 'typed'] as const;

export interface OpeningLineDto {
  id: number;
  kind: OpeningLineKind;
  account: { id: number; number: string; name: string; accountClass: AccountClass };
  place: { id: number; kind: 'till' | 'safe' | 'bank'; name: string | null } | null;
  party: { id: number; name: string } | null;
  /** On the account's usual side: money in a till, a debt to a supplier, VAT to claim back are above zero. */
  amount: number;
  trefinAmount: number | null;
  source: OpeningSource;
  note: string | null;
  /** Confirmed, and nothing has changed since. */
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Its figure can be typed here (places, other accounts, a partner with nothing brought over). */
  editable: boolean;
  /** Stock: how many products carry it and how many have no cost. Partners: how many bills or charges make it. */
  facts: { products?: number; noCost?: number; documents?: number };
}

export interface OpeningDto {
  startDay: string | null;
  posted: { entryId: number; at: string; by: string | null } | null;
  trefin: { at: string; off: number; skipped: Array<{ what: string; amount: number }> } | null;
  lines: OpeningLineDto[];
  /** The difference that makes the entry balance, on owners' capital: what the shop has minus what it owes. */
  capital: { account: { id: number; number: string; name: string }; amount: number };
  /** Debits and credits of the lines before the capital line. */
  debits: number;
  credits: number;
  confirmed: number;
  /** Why it can't be posted yet; empty when it can. */
  blockers: Array<'no_start' | 'unconfirmed' | 'posted' | 'empty'>;
}

interface Posted {
  entryId: number;
  at: string;
  by: number;
  /** What each place's opening balance was before, to put back on a take-back. */
  places: Array<{ id: number; balance: number; day: string | null }>;
}

interface TrefinLoaded {
  at: string;
  day: string;
  off: number;
  skipped: Array<{ what: string; amount: number }>;
}

interface LineRow {
  id: number;
  kind: OpeningLineKind;
  account_id: number | null;
  place_id: number | null;
  supplier_id: number | null;
  customer_id: number | null;
  amount: string | null;
  trefin_amount: string | null;
  source: OpeningSource;
  note: string | null;
  confirmed_amount: string | null;
  confirmed_at: Date | null;
  confirmed_name: string | null;
  place_kind: 'till' | 'safe' | 'bank' | null;
  place_name: string | null;
  place_account: number | null;
  party_name: string | null;
}

const natural = (accountClass: AccountClass, debitMinusCredit: number) => roundMoney(DEBIT_CLASSES.includes(accountClass) ? debitMinusCredit : -debitMinusCredit);
const fromNatural = natural;
const n = (value: string | number | null | undefined) => (value === null || value === undefined ? null : Number(value));

/**
 * What the shop has and owes on the day the books start, line by line: the
 * money in each till, safe and bank account (counted, or from the statement),
 * the stock at cost, what each supplier and customer owes, and any other
 * balance the accountant brings from TREFIN (VAT, taxes, fixed assets). Each
 * line shows where its figure came from and what TREFIN said, and is posted
 * only once a person confirmed every one. The difference goes to the owners'
 * capital, so the entry always balances.
 */
export class OpeningService {
  private readonly periods: VatMonthRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly timeZone: string,
  ) {
    this.periods = new VatMonthRepository(db);
  }

  private async setting<T>(key: string, db: DatabaseClient = this.db): Promise<T | null> {
    const row = await db.selectFrom('settings').select('value').where('key', '=', key).executeTakeFirst();
    return (row?.value as T | undefined) ?? null;
  }

  private async putSetting(db: DatabaseClient, key: string, value: unknown, actorId: number | null): Promise<void> {
    await sql`
      insert into settings (key, value, updated_by, updated_at) values (${key}, ${JSON.stringify(value)}, ${actorId}, now())
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `.execute(db);
  }

  private async links(db: DatabaseClient): Promise<Record<'stock' | 'payables' | 'receivables' | 'owner_in', number>> {
    const rows = await db.selectFrom('ledger_links').select(['key', 'account_id']).where('key', 'in', ['stock', 'payables', 'receivables', 'owner_in']).execute();
    const links = Object.fromEntries(rows.map((row) => [row.key, row.account_id]));
    for (const key of ['stock', 'payables', 'receivables', 'owner_in']) if (!links[key]) throw new Error(`The books have no account for ${key}`);
    return links as Record<'stock' | 'payables' | 'receivables' | 'owner_in', number>;
  }

  /** Every place in the books and the stock get a line, so nothing is forgotten. */
  private async ensureBaseLines(db: DatabaseClient): Promise<void> {
    await ensurePlaces(db as never);
    await sql`
      insert into opening_lines (kind, place_id, account_id, amount, source)
      select 'place', p.id, p.account_id, 0, 'typed' from money_places p
      where p.archived_at is null and p.account_id is not null and p.carwash_id is null
        and not exists (select 1 from opening_lines o where o.place_id = p.id)
    `.execute(db);
    const links = await this.links(db);
    await sql`
      insert into opening_lines (kind, account_id, source)
      select 'stock', ${links.stock}, 'stock' where not exists (select 1 from opening_lines where kind = 'stock')
    `.execute(db);
  }

  private async posted(db: DatabaseClient = this.db): Promise<Posted | null> {
    return this.setting<Posted>(OPENING_POSTED_KEY, db);
  }

  private async assertNotPosted(db: DatabaseClient = this.db): Promise<void> {
    if (await this.posted(db)) throw new ConflictError('The opening balances are posted. Take them back first to change a line.');
  }

  /** The figures worked out from the rest of 4VD: stock at cost (without VAT), and each partner's brought-over bills and charges. */
  private async workedOut(db: DatabaseClient) {
    const stock = await sql<{ value: string; products: string; no_cost: string }>`
      select coalesce(sum(i.quantity_on_hand * coalesce(p.cost_price, 0) / (1 + p.vat_rate / 100.0)), 0) as value,
        count(*) filter (where i.quantity_on_hand > 0) as products,
        count(*) filter (where i.quantity_on_hand > 0 and coalesce(p.cost_price, 0) <= 0) as no_cost
      from inventory i join products p on p.id = i.product_id
      where p.deleted_at is null
    `.execute(db);
    const bills = await sql<{ supplier_id: number; owed: string; documents: string }>`
      select supplier_id, sum(amount) as owed, count(*) as documents from supplier_bills
      where brought_over and voided_at is null and supplier_id is not null group by supplier_id
    `.execute(db);
    const charges = await sql<{ customer_id: number; owed: string; documents: string }>`
      select customer_id, sum(amount) as owed, count(*) as documents from tab_entries
      where brought_over and kind = 'charge' group by customer_id
    `.execute(db);
    const row = stock.rows[0]!;
    return {
      stock: { value: roundMoney(Number(row.value)), products: Number(row.products), noCost: Number(row.no_cost) },
      suppliers: new Map(bills.rows.map((bill) => [bill.supplier_id, { owed: Number(bill.owed), documents: Number(bill.documents) }])),
      customers: new Map(charges.rows.map((charge) => [charge.customer_id, { owed: Number(charge.owed), documents: Number(charge.documents) }])),
    };
  }

  private async lineRows(db: DatabaseClient): Promise<LineRow[]> {
    const { rows } = await sql<LineRow>`
      select o.id, o.kind, o.account_id, o.place_id, o.supplier_id, o.customer_id, o.amount, o.trefin_amount, o.source, o.note,
        o.confirmed_amount, o.confirmed_at, u.name as confirmed_name,
        p.kind as place_kind, coalesce(p.name, c.name) as place_name, p.account_id as place_account,
        coalesce(s.name, cu.name) as party_name
      from opening_lines o
      left join users u on u.id = o.confirmed_by
      left join money_places p on p.id = o.place_id
      left join carwashes c on c.id = p.carwash_id
      left join suppliers s on s.id = o.supplier_id
      left join customers cu on cu.id = o.customer_id
      order by o.id
    `.execute(db);
    return rows;
  }

  async view(db: DatabaseClient = this.db): Promise<OpeningDto> {
    const posted = await this.posted(db);
    if (!posted) await this.ensureBaseLines(db);
    const [startDay, trefin, links, rows, worked, accounts] = await Promise.all([
      this.setting<string>(BOOKS_START_KEY, db),
      this.setting<TrefinLoaded>(OPENING_TREFIN_KEY, db),
      this.links(db),
      this.lineRows(db),
      this.workedOut(db),
      new BooksRepository(db).accounts(),
    ]);
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const accountOf = (id: number) => {
      const account = accountById.get(id);
      if (!account) throw new Error(`Account ${id} is missing`);
      return { id: account.id, number: account.number, name: account.name, accountClass: account.class as AccountClass };
    };

    let debits = 0;
    let credits = 0;
    const lines: OpeningLineDto[] = rows.map((row) => {
      const accountId = row.kind === 'place' ? row.place_account! : row.kind === 'supplier' ? links.payables : row.kind === 'customer' ? links.receivables : row.account_id!;
      const account = accountOf(accountId);
      let debitMinusCredit: number;
      let facts: OpeningLineDto['facts'] = {};
      let editable = TYPED_KINDS.includes(row.kind);
      if (row.kind === 'stock') {
        debitMinusCredit = worked.stock.value;
        facts = { products: worked.stock.products, noCost: worked.stock.noCost };
      } else if (row.kind === 'supplier' || row.kind === 'customer') {
        const brought = (row.kind === 'supplier' ? worked.suppliers.get(row.supplier_id!) : worked.customers.get(row.customer_id!)) ?? null;
        editable = brought === null;
        facts = { documents: brought?.documents ?? 0 };
        const owed = brought ? brought.owed : (n(row.amount) ?? 0);
        // A brought-over bill is owed to the supplier (a credit), a tab charge is owed by the customer (a debit).
        debitMinusCredit = brought ? (row.kind === 'supplier' ? -owed : owed) : owed;
      } else debitMinusCredit = n(row.amount) ?? 0;
      debitMinusCredit = roundMoney(debitMinusCredit);
      if (debitMinusCredit > 0) debits += debitMinusCredit;
      else credits -= debitMinusCredit;
      const confirmedAmount = n(row.confirmed_amount);
      return {
        id: row.id,
        kind: row.kind,
        account,
        place: row.place_id ? { id: row.place_id, kind: row.place_kind!, name: row.place_name } : null,
        party: row.supplier_id ? { id: row.supplier_id, name: row.party_name ?? '' } : row.customer_id ? { id: row.customer_id, name: row.party_name ?? '' } : null,
        amount: natural(account.accountClass, debitMinusCredit),
        trefinAmount: row.trefin_amount === null ? null : natural(account.accountClass, Number(row.trefin_amount)),
        source: row.source,
        note: row.note,
        confirmed: confirmedAmount !== null && roundMoney(confirmedAmount) === debitMinusCredit,
        confirmedBy: row.confirmed_name,
        confirmedAt: row.confirmed_at?.toISOString() ?? null,
        editable: editable && !posted,
        facts,
      };
    });
    debits = roundMoney(debits);
    credits = roundMoney(credits);
    const capitalAccount = accountOf(links.owner_in);
    const confirmed = lines.filter((line) => line.confirmed).length;
    const blockers: OpeningDto['blockers'] = [];
    if (posted) blockers.push('posted');
    if (!startDay) blockers.push('no_start');
    if (confirmed < lines.length) blockers.push('unconfirmed');
    if (debits === 0 && credits === 0) blockers.push('empty');
    const by = posted ? await db.selectFrom('users').select('name').where('id', '=', posted.by).executeTakeFirst() : undefined;
    return {
      startDay,
      posted: posted ? { entryId: posted.entryId, at: posted.at, by: by?.name ?? null } : null,
      trefin: trefin ? { at: trefin.at, off: trefin.off, skipped: trefin.skipped } : null,
      lines,
      capital: { account: { id: capitalAccount.id, number: capitalAccount.number, name: capitalAccount.name }, amount: roundMoney(debits - credits) },
      debits,
      credits,
      confirmed,
      blockers,
    };
  }

  private async findLine(db: DatabaseClient, id: number) {
    const line = await db.selectFrom('opening_lines').selectAll().where('id', '=', id).executeTakeFirst();
    if (!line) throw new NotFoundError(`Opening line ${id} does not exist`);
    return line;
  }

  private async accountClassOf(db: DatabaseClient, line: { kind: OpeningLineKind; account_id: number | null; place_id: number | null }): Promise<AccountClass> {
    const links = await this.links(db);
    const accountId =
      line.kind === 'place'
        ? (await db.selectFrom('money_places').select('account_id').where('id', '=', line.place_id!).executeTakeFirstOrThrow()).account_id!
        : line.kind === 'supplier'
          ? links.payables
          : line.kind === 'customer'
            ? links.receivables
            : line.account_id!;
    const account = await db.selectFrom('ledger_accounts').select('class').where('id', '=', accountId).executeTakeFirstOrThrow();
    return account.class as AccountClass;
  }

  /** Change a typed line's figure, where it came from, or its note. A changed figure needs confirming again. */
  async updateLine(id: number, input: { amount?: number; source?: (typeof TYPED_SOURCES)[number]; note?: string | null }, actorId: number): Promise<OpeningDto> {
    await this.db.transaction().execute(async (trx) => {
      await this.assertNotPosted(trx);
      const line = await this.findLine(trx, id);
      if (input.amount !== undefined) {
        const worked = await this.workedOut(trx);
        const hasDocuments = (line.supplier_id !== null && worked.suppliers.has(line.supplier_id)) || (line.customer_id !== null && worked.customers.has(line.customer_id));
        if (line.kind === 'stock') throw new ValidationError('The stock figure is worked out from the stock and its costs. Fix a product\'s stock or cost and it follows.');
        if (hasDocuments) throw new ValidationError('This balance is made of the bills or charges brought over. Change those, and it follows.');
      }
      const accountClass = await this.accountClassOf(trx, line);
      // A new figure typed over TREFIN's came from somewhere else: a count, the bank's statement, or someone's list.
      let source = input.source;
      if (source === undefined && input.amount !== undefined && line.source === 'trefin') {
        const place = line.place_id ? await trx.selectFrom('money_places').select('kind').where('id', '=', line.place_id).executeTakeFirst() : undefined;
        source = place ? (place.kind === 'bank' ? 'statement' : 'counted') : 'typed';
      }
      await trx
        .updateTable('opening_lines')
        .set({
          ...(input.amount !== undefined && { amount: fromNatural(accountClass, input.amount) }),
          ...(source !== undefined && { source }),
          ...(input.note !== undefined && { note: input.note?.trim() || null }),
          updated_by: actorId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
    });
    return this.view();
  }

  /** Another balance from TREFIN or the accountant: VAT, taxes, fixed assets, a loan. */
  async addAccountLine(input: { accountId: number; amount: number; note?: string | null }, actorId: number): Promise<OpeningDto> {
    await this.db.transaction().execute(async (trx) => {
      await this.assertNotPosted(trx);
      const account = await trx.selectFrom('ledger_accounts').select(['id', 'number', 'name', 'class', 'archived_at']).where('id', '=', input.accountId).executeTakeFirst();
      if (!account) throw new ValidationError(`Account ${input.accountId} does not exist.`);
      if (account.archived_at) throw new ValidationError(`Account ${account.number} ${account.name} is archived. Pick another one.`);
      const links = await this.links(trx);
      const place = await trx.selectFrom('money_places').select('id').where('account_id', '=', account.id).executeTakeFirst();
      if (place) throw new ValidationError(`${account.number} ${account.name} is a till, safe or bank account; it has its own line above.`);
      if (account.id === links.stock) throw new ValidationError('Stock has its own line, worked out from the products.');
      if (account.id === links.owner_in) throw new ValidationError("Owners' capital is the difference 4VD works out at the end, so the entry balances.");
      if (!['asset', 'liability', 'equity'].includes(account.class)) throw new ValidationError('Only what the shop has, owes and its capital carry over. Income and costs start from zero; profit so far goes on 3300.');
      const taken = await trx.selectFrom('opening_lines').select('id').where('kind', '=', 'account').where('account_id', '=', account.id).executeTakeFirst();
      if (taken) throw new ValidationError(`${account.number} ${account.name} already has a line. Change that one.`);
      await trx
        .insertInto('opening_lines')
        .values({ kind: 'account', account_id: account.id, amount: fromNatural(account.class as AccountClass, input.amount), source: 'typed', note: input.note?.trim() || null, updated_by: actorId })
        .execute();
    });
    return this.view();
  }

  async removeLine(id: number): Promise<OpeningDto> {
    await this.db.transaction().execute(async (trx) => {
      await this.assertNotPosted(trx);
      const line = await this.findLine(trx, id);
      if (line.kind !== 'account') throw new ValidationError('Only a line added for another account can be removed. Set this one to 0 instead.');
      await trx.deleteFrom('opening_lines').where('id', '=', id).execute();
    });
    return this.view();
  }

  /** "This figure is right": stays confirmed until the figure changes. */
  async confirm(ids: number[], confirmed: boolean, actorId: number): Promise<OpeningDto> {
    await this.db.transaction().execute(async (trx) => {
      await this.assertNotPosted(trx);
      const view = await this.view(trx);
      for (const id of ids) {
        const line = view.lines.find((candidate) => candidate.id === id);
        if (!line) throw new NotFoundError(`Opening line ${id} does not exist`);
        await trx
          .updateTable('opening_lines')
          .set(
            confirmed
              ? { confirmed_amount: fromNatural(line.account.accountClass, line.amount), confirmed_by: actorId, confirmed_at: new Date() }
              : { confirmed_amount: null, confirmed_by: null, confirmed_at: null },
          )
          .where('id', '=', id)
          .execute();
      }
    });
    return this.view();
  }

  /**
   * Write the opening entry on the books' first day: one line per figure, the
   * difference on the owners' capital. Each till, safe and bank account starts
   * from its figure on that day, so the Money page and the books agree.
   */
  async post(actorId: number): Promise<OpeningDto> {
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(40840)`.execute(trx);
      const view = await this.view(trx);
      if (view.blockers.includes('posted')) throw new ConflictError('The opening balances are already posted.');
      if (!view.startDay) throw new ValidationError('Set the day the books start first (Settings → Books).');
      const open = view.lines.filter((line) => !line.confirmed).length;
      if (open > 0) throw new ValidationError(`${open} ${open === 1 ? 'line is' : 'lines are'} not confirmed yet. Check and confirm every line first.`);
      if (view.blockers.includes('empty')) throw new ValidationError('Every line is 0, so there is nothing to post.');
      await assertMonthsOpen(new VatMonthRepository(trx), [view.startDay]);

      const draft = view.lines
        .map((line) => ({ line, dmc: fromNatural(line.account.accountClass, line.amount) }))
        .filter(({ dmc }) => dmc !== 0)
        .map(({ line, dmc }) => ({
          accountId: line.account.id,
          debit: dmc > 0 ? dmc : 0,
          credit: dmc < 0 ? -dmc : 0,
          supplierId: line.kind === 'supplier' ? line.party!.id : null,
          customerId: line.kind === 'customer' ? line.party!.id : null,
          memo: line.kind === 'stock' ? `${line.facts.products ?? 0} products at cost` : (line.note?.slice(0, 300) ?? null),
        }));
      if (view.capital.amount !== 0) {
        draft.push({
          accountId: view.capital.account.id,
          debit: view.capital.amount < 0 ? -view.capital.amount : 0,
          credit: view.capital.amount > 0 ? view.capital.amount : 0,
          supplierId: null,
          customerId: null,
          memo: 'What the shop has minus what it owes',
        });
      }
      const entryId = await new BooksRepository(trx).addManualEntry({ date: view.startDay, description: 'Opening balances: what the shop had and owed when 4VD took over from TREFIN', createdBy: actorId });
      await insertLines(trx, entryId, draft, draft.map((line) => line.memo));

      const places: Posted['places'] = [];
      for (const line of view.lines.filter((candidate) => candidate.kind === 'place')) {
        const before = await trx.selectFrom('money_places').select(['opening_balance', sql<string | null>`to_char(opening_day, 'YYYY-MM-DD')`.as('opening_day')]).where('id', '=', line.place!.id).executeTakeFirstOrThrow();
        places.push({ id: line.place!.id, balance: Number(before.opening_balance), day: before.opening_day });
        await trx.updateTable('money_places').set({ opening_balance: line.amount, opening_day: view.startDay }).where('id', '=', line.place!.id).execute();
      }
      await this.putSetting(trx, OPENING_POSTED_KEY, { entryId, at: new Date().toISOString(), by: actorId, places } satisfies Posted, actorId);
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'books.opening_posted',
        entityType: 'ledger_entry',
        entityId: entryId,
        say: { key: 'openingPosted', params: { id: entryId, day: view.startDay, amount: view.debits + Math.max(0, -view.capital.amount) } },
        details: { debits: view.debits, credits: view.credits, capital: view.capital.amount },
      });
    });
    return this.view();
  }

  /** Cancel the opening entry with its mirror image, so the lines can change. Needs a reason. */
  async takeBack(reason: string, actorId: number): Promise<OpeningDto> {
    const why = reason.trim();
    if (why.length < 3) throw new ValidationError('Say why the opening balances are taken back, so the accountant can follow it later.');
    await this.db.transaction().execute(async (trx) => {
      const posted = await this.posted(trx);
      if (!posted) throw new ConflictError('The opening balances are not posted.');
      const entry = await trx.selectFrom('ledger_entries').select([sql<string>`to_char(entry_date, 'YYYY-MM-DD')`.as('day'), 'reversed_at']).where('id', '=', posted.entryId).executeTakeFirst();
      if (entry) {
        await assertMonthsOpen(new VatMonthRepository(trx), [entry.day]);
        if (!entry.reversed_at) await reverseEntry(trx, posted.entryId, actorId, null);
      }
      for (const place of posted.places) {
        await trx.updateTable('money_places').set({ opening_balance: place.balance, opening_day: place.day }).where('id', '=', place.id).execute();
      }
      await trx.deleteFrom('settings').where('key', '=', OPENING_POSTED_KEY).execute();
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'books.opening_taken_back',
        entityType: 'ledger_entry',
        entityId: posted.entryId,
        say: { key: 'openingTakenBack', params: { id: posted.entryId, reason: why } },
      });
    });
    return this.view();
  }

  /**
   * Fill the lines from TREFIN's books on the evening before the books start:
   * its figure beside every line, the open supplier bills and customer
   * balances brought over, and its other balances as lines to confirm. Can run
   * again (after a newer export) until the opening is posted; typed figures
   * and confirmations of lines that didn't change stay.
   */
  async loadTrefin(data: TrefinOpening, actorId: number | null): Promise<{ bills: number; charges: number; lines: number; skipped: TrefinLoaded['skipped'] }> {
    return this.db.transaction().execute(async (trx) => {
      await this.assertNotPosted(trx);
      const startDay = await this.setting<string>(BOOKS_START_KEY, trx);
      if (startDay !== data.day) throw new ValidationError(`The books start on ${startDay ?? '(not set)'}, but the TREFIN figures were worked out for ${data.day}.`);
      const paid = await sql<{ n: string }>`
        select count(*) as n from supplier_payments sp join supplier_bills b on b.id = sp.bill_id where b.brought_over and sp.voided_at is null
      `.execute(trx);
      if (Number(paid.rows[0]!.n) > 0) throw new ConflictError('Some brought-over bills have payments already, so they can no longer be replaced. Change them one by one instead.');
      await this.ensureBaseLines(trx);
      const links = await this.links(trx);

      // Start again from TREFIN: its bills, charges and lines go; what people typed stays.
      await trx.deleteFrom('supplier_bills').where('brought_over', '=', true).execute();
      await trx.deleteFrom('tab_entries').where('brought_over', '=', true).execute();
      await trx.deleteFrom('opening_lines').where('kind', 'in', ['supplier', 'customer']).execute();
      await trx.deleteFrom('opening_lines').where('kind', '=', 'account').where('source', '=', 'trefin').execute();
      await trx.updateTable('opening_lines').set({ trefin_amount: null }).execute();

      const skipped: TrefinLoaded['skipped'] = [];
      const accounts = await trx.selectFrom('ledger_accounts').select(['id', 'number', 'name', 'class']).where('archived_at', 'is', null).execute();
      const byNumber = new Map(accounts.map((account) => [account.number, account]));
      const places = await trx.selectFrom('money_places').select(['id', 'account_id']).where('account_id', 'is not', null).execute();
      const placeByAccount = new Map(places.map((place) => [place.account_id!, place.id]));
      // The minute before the books start, and the day before.
      const lastEvening = new Date(startOfDay(data.day, this.timeZone).getTime() - 60_000);
      const dayBefore = new Date(Date.parse(`${data.day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      let lines = 0;

      const accountLine = async (accountId: number, amount: number, note: string) => {
        const existing = await trx.selectFrom('opening_lines').select(['id', 'source']).where('kind', '=', 'account').where('account_id', '=', accountId).executeTakeFirst();
        if (existing) await trx.updateTable('opening_lines').set({ trefin_amount: amount }).where('id', '=', existing.id).execute();
        else await trx.insertInto('opening_lines').values({ kind: 'account', account_id: accountId, amount, trefin_amount: amount, source: 'trefin', note, updated_by: actorId }).execute();
        lines++;
      };

      for (const [number, amount] of data.accounts) {
        const account = byNumber.get(number);
        if (!account) {
          skipped.push({ what: `TREFIN account ${number}, not in 4VD's chart`, amount });
          continue;
        }
        const placeId = placeByAccount.get(account.id);
        if (placeId !== undefined) {
          // TREFIN's till figure is shown beside the line, but the till is counted: start from it only when nothing was typed.
          await sql`
            update opening_lines set trefin_amount = ${amount},
              amount = case when amount = 0 and source = 'typed' then ${amount} else amount end,
              source = case when amount = 0 and source = 'typed' then 'trefin' else source end
            where place_id = ${placeId}
          `.execute(trx);
        } else if (account.id === links.stock) {
          await trx.updateTable('opening_lines').set({ trefin_amount: amount }).where('kind', '=', 'stock').execute();
        } else if (account.id === links.owner_in) {
          skipped.push({ what: `TREFIN's owners' capital (${number}): 4VD works it out as the difference`, amount });
        } else await accountLine(account.id, amount, `From TREFIN account ${number}`);
      }

      const profit = [
        { number: '3300', amount: data.profitThisYear, note: `Profit or loss in TREFIN from 1 January ${data.day.slice(0, 4)}` },
        { number: '3400', amount: data.profitEarlier, note: 'Profit or loss in TREFIN from the years before' },
      ];
      for (const { number, amount, note } of profit) {
        if (amount === 0) continue;
        const account = byNumber.get(number);
        if (!account) skipped.push({ what: note, amount });
        else {
          const already = data.accounts.get(number) ?? 0;
          if (already !== 0) await sql`update opening_lines set amount = amount + ${amount}, trefin_amount = trefin_amount + ${amount} where kind = 'account' and account_id = ${account.id} and source = 'trefin'`.execute(trx);
          else await accountLine(account.id, amount, note);
        }
      }
      if (data.payablesWithoutPartner !== 0) skipped.push({ what: 'Owed to suppliers in TREFIN with no supplier named', amount: data.payablesWithoutPartner });
      if (data.receivablesWithoutPartner !== 0) skipped.push({ what: 'Owed by customers in TREFIN with no customer named', amount: data.receivablesWithoutPartner });

      // Suppliers: each one's newest invoices are what's still open.
      let bills = 0;
      const suppliers = await trx.selectFrom('suppliers').select(['id', 'external_code']).where('external_code', 'is not', null).execute();
      const supplierByCode = new Map(suppliers.map((supplier) => [supplier.external_code!, supplier.id]));
      for (const [code, balance] of data.suppliers) {
        const supplierId = supplierByCode.get(code);
        if (supplierId === undefined) {
          skipped.push({ what: `Supplier ${code} in TREFIN, not in 4VD`, amount: balance });
          continue;
        }
        const owed = roundMoney(-balance);
        if (owed > 0) {
          const { bills: open, rest } = openBills(
            owed,
            data.purchases.filter((purchase) => purchase.supplierCode === code),
          );
          const rows = open.map((bill) => ({
            supplier_id: supplierId,
            number: bill.number.slice(0, 100) || null,
            issued_on: bill.day,
            amount: bill.open,
            note:
              bill.open < bill.total
                ? `Brought over from TREFIN: ${formatEuro(bill.open)} of ${formatEuro(bill.total)} was still open.`
                : 'Brought over from TREFIN: still open on the day 4VD took over.',
            brought_over: true,
            created_by: actorId,
          }));
          if (rest > 0) {
            rows.push({ supplier_id: supplierId, number: null, issued_on: dayBefore, amount: rest, note: 'Brought over from TREFIN: an older balance with no invoice behind it in the export.', brought_over: true, created_by: actorId });
          }
          if (rows.length > 0) await trx.insertInto('supplier_bills').values(rows).execute();
          bills += rows.length;
          await trx.insertInto('opening_lines').values({ kind: 'supplier', supplier_id: supplierId, trefin_amount: balance, source: 'trefin', updated_by: actorId }).execute();
        } else {
          await trx
            .insertInto('opening_lines')
            .values({ kind: 'supplier', supplier_id: supplierId, amount: balance, trefin_amount: balance, source: 'trefin', note: 'TREFIN shows you paid them more than their bills.', updated_by: actorId })
            .execute();
        }
        lines++;
      }

      // Customers: what each one owes becomes one charge on their tab.
      let charges = 0;
      const customers = await trx.selectFrom('customers').select(['id', 'external_code']).where('external_code', 'is not', null).execute();
      const customerByCode = new Map(customers.map((customer) => [customer.external_code!, customer.id]));
      for (const [code, balance] of data.customers) {
        const customerId = customerByCode.get(code);
        if (customerId === undefined) {
          skipped.push({ what: `Customer ${code} in TREFIN, not in 4VD`, amount: balance });
          continue;
        }
        if (balance > 0) {
          await trx
            .insertInto('tab_entries')
            .values({ customer_id: customerId, kind: 'charge', amount: balance, note: 'Brought over from TREFIN: owed on the day 4VD took over.', occurred_at: lastEvening, created_by: actorId, brought_over: true })
            .execute();
          charges++;
          await trx.insertInto('opening_lines').values({ kind: 'customer', customer_id: customerId, trefin_amount: balance, source: 'trefin', updated_by: actorId }).execute();
        } else {
          await trx
            .insertInto('opening_lines')
            .values({ kind: 'customer', customer_id: customerId, amount: balance, trefin_amount: balance, source: 'trefin', note: 'TREFIN shows they paid more than they owed.', updated_by: actorId })
            .execute();
        }
        lines++;
      }

      await this.putSetting(trx, OPENING_TREFIN_KEY, { at: new Date().toISOString(), day: data.day, off: data.off, skipped } satisfies TrefinLoaded, actorId);
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'books.opening_trefin_loaded',
        entityType: null,
        entityId: null,
        say: { key: 'openingTrefinLoaded', params: { bills, charges, lines } },
      });
      return { bills, charges, lines, skipped };
    });
  }
}
