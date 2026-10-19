import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { accountForPlace, ensurePlaces } from '../database/places.js';
import type { BankLineDoneKind, BankLineStatus, BankRuleAction, MoneyPlaceKind, SupplierPaymentMethod } from '../database/types.js';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';

export interface PlaceRecord {
  id: number;
  kind: MoneyPlaceKind;
  name: string | null;
  carwash_id: number | null;
  carwash_name: string | null;
  bank_name: string | null;
  iban: string | null;
  account_id: number | null;
  account_number: string | null;
  account_name: string | null;
  is_default: boolean;
  opening_balance: string;
  opening_day: string | null;
  statement_layout: unknown;
  archived_at: Date | null;
}

/** A place in an activity sentence: its name, or (null) the usual name of its kind in the reader's language. */
export interface PlaceWords {
  kind: MoneyPlaceKind;
  name: string | null;
}

export const placeWords = (place: Pick<PlaceRecord, 'kind' | 'name' | 'carwash_name'>): PlaceWords => ({ kind: place.kind, name: place.name ?? place.carwash_name });

/** How a payment was made, from the place it came from: a till is the drawer, the safe other cash, a bank a transfer. */
export const methodOf = (kind: MoneyPlaceKind): Exclude<SupplierPaymentMethod, 'credit'> => (kind === 'till' ? 'drawer' : kind === 'safe' ? 'cash' : 'bank');

export interface MoveRecord {
  id: number;
  day: string;
  amount: string;
  from_place_id: number | null;
  to_place_id: number | null;
  note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: Date;
  voided_at: Date | null;
}

export interface BankLineRecord {
  id: number;
  statement_id: number;
  place_id: number;
  day: string;
  text: string;
  amount: string;
  balance: string | null;
  position: number;
  status: BankLineStatus;
  done_kind: BankLineDoneKind | null;
  done_ref: number | null;
  made_record: boolean;
  rule_id: number | null;
  done_by_name: string | null;
  done_at: Date | null;
}

export interface BankRuleRecord {
  id: number;
  place_id: number | null;
  contains: string;
  direction: 'in' | 'out';
  action: BankRuleAction;
  category: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  other_place_id: number | null;
  created_at: Date;
}

export interface RuleFields {
  placeId: number | null;
  contains: string;
  direction: 'in' | 'out';
  action: BankRuleAction;
  category: string | null;
  supplierId: number | null;
  otherPlaceId: number | null;
}

/** The places money is kept and the moves between them. */
/**
 * Each day's sales paid by card (the bank's terminal), by the day they were
 * sold, with the card part of split payments (never more than what is left of
 * that sale once lines are undone).
 */
export const cardSalesSql = (timeZone: string) => sql`
  select day, sum(amount) as amount from (
    select (s.sale_date at time zone ${timeZone})::date as day, s.total_amount as amount
    from sales s join document_lines dl on dl.sale_id = s.id join documents d on d.id = dl.document_id
    where d.kind = 'invoice' and d.payment_method = 'card' and s.undone_at is null
    union all
    select min((s.sale_date at time zone ${timeZone})::date), least(d.card_amount, sum(s.total_amount))
    from documents d join document_lines dl on dl.document_id = d.id join sales s on s.id = dl.sale_id
    where d.kind = 'invoice' and d.card_amount is not null and s.undone_at is null
    group by d.id, d.card_amount
  ) c
  group by day
`;

export class MoneyRepository {
  constructor(private readonly db: DatabaseClient) {}

  ensure(): Promise<void> {
    return ensurePlaces(this.db as never);
  }

  private placeQuery() {
    return this.db
      .selectFrom('money_places as p')
      .leftJoin('carwashes as c', 'c.id', 'p.carwash_id')
      .leftJoin('ledger_accounts as a', 'a.id', 'p.account_id')
      .select([
        'p.id',
        'p.kind',
        'p.name',
        'p.carwash_id',
        'c.name as carwash_name',
        'p.bank_name',
        'p.iban',
        'p.account_id',
        'a.number as account_number',
        'a.name as account_name',
        'p.is_default',
        'p.opening_balance',
        sql<string | null>`to_char(p.opening_day, 'YYYY-MM-DD')`.as('opening_day'),
        'p.statement_layout',
        'p.archived_at',
      ]);
  }

  /** Tills first (the shop's, then the carwashes'), then safes, then banks. */
  async places(): Promise<PlaceRecord[]> {
    await this.ensure();
    return this.placeQuery()
      .orderBy(sql`case p.kind when 'till' then 0 when 'safe' then 1 else 2 end`)
      .orderBy(sql`p.carwash_id is not null`)
      .orderBy('p.is_default', 'desc')
      .orderBy('p.id')
      .execute();
  }

  async place(id: number): Promise<PlaceRecord | undefined> {
    await this.ensure();
    return this.placeQuery().where('p.id', '=', id).executeTakeFirst();
  }

  async placeOrThrow(id: number): Promise<PlaceRecord> {
    const place = await this.place(id);
    if (!place) throw new NotFoundError(`There is no place ${id} money is kept`);
    return place;
  }

  /** The place a payment came from, by id, or by how it was paid (the drawer is the shop's till, cash the safe, bank the bank). */
  async payFrom(input: { placeId?: number | null; method?: Exclude<SupplierPaymentMethod, 'credit'> | null }): Promise<{ placeId: number; method: Exclude<SupplierPaymentMethod, 'credit'> }> {
    await this.ensure();
    if (input.placeId) {
      const place = await this.placeOrThrow(input.placeId);
      if (place.archived_at) throw new ValidationError('That place is closed; pick another');
      return { placeId: place.id, method: methodOf(place.kind) };
    }
    const method = input.method ?? 'drawer';
    const row = await this.db
      .selectFrom('money_places')
      .select('id')
      .$call((query) =>
        method === 'drawer' ? query.where('kind', '=', 'till').where('carwash_id', 'is', null) : query.where('kind', '=', method === 'cash' ? 'safe' : 'bank').where('is_default', '=', true),
      )
      .executeTakeFirstOrThrow();
    return { placeId: row.id, method };
  }

  async shopTillId(): Promise<number> {
    return (await this.payFrom({ method: 'drawer' })).placeId;
  }

  /** A new account in the books for a new place, under 1110 or 1120. */
  newAccount(kind: MoneyPlaceKind, name: string | null): Promise<number> {
    return accountForPlace(this.db as never, kind, name);
  }

  /** The bank statement line that became or found this record, if one did. */
  lineFor(kind: BankLineDoneKind, ref: number) {
    return this.db.selectFrom('bank_lines').select(['id', 'statement_id']).where('status', '=', 'done').where('done_kind', '=', kind).where('done_ref', '=', ref).executeTakeFirst();
  }

  async addBank(input: { name: string; bankName: string | null; iban: string | null; accountId: number; openingBalance: number; openingDay: string | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('money_places')
      .values({
        kind: 'bank',
        name: input.name,
        bank_name: input.bankName,
        iban: input.iban,
        account_id: input.accountId,
        opening_balance: input.openingBalance,
        opening_day: input.openingDay,
        created_by: input.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async addSafe(input: { name: string; accountId: number; openingBalance: number; openingDay: string | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('money_places')
      .values({ kind: 'safe', name: input.name, account_id: input.accountId, opening_balance: input.openingBalance, opening_day: input.openingDay, created_by: input.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updatePlace(
    id: number,
    changes: Partial<{ name: string | null; bank_name: string | null; iban: string | null; opening_balance: number; opening_day: string | null; archived_at: Date | null; is_default: boolean }>,
  ): Promise<void> {
    if (Object.keys(changes).length === 0) return;
    await this.db.updateTable('money_places').set(changes).where('id', '=', id).execute();
  }

  async clearDefault(kind: MoneyPlaceKind): Promise<void> {
    await this.db.updateTable('money_places').set({ is_default: false }).where('kind', '=', kind).where('is_default', '=', true).execute();
  }

  async saveLayout(id: number, layout: unknown): Promise<void> {
    await this.db.updateTable('money_places').set({ statement_layout: JSON.stringify(layout) }).where('id', '=', id).execute();
  }

  async addMove(move: { day: string; amount: number; fromPlaceId: number | null; toPlaceId: number | null; note: string | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('money_moves')
      .values({ day: move.day, amount: move.amount, from_place_id: move.fromPlaceId, to_place_id: move.toPlaceId, note: move.note, created_by: move.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  findMove(id: number): Promise<MoveRecord | undefined> {
    return this.db
      .selectFrom('money_moves as m')
      .leftJoin('users as u', 'u.id', 'm.created_by')
      .select([
        'm.id',
        sql<string>`to_char(m.day, 'YYYY-MM-DD')`.as('day'),
        'm.amount',
        'm.from_place_id',
        'm.to_place_id',
        'm.note',
        'm.created_by',
        'u.name as created_by_name',
        'm.created_at',
        'm.voided_at',
      ])
      .where('m.id', '=', id)
      .executeTakeFirst();
  }

  async voidMove(id: number, by: number, at: Date): Promise<void> {
    await this.db.updateTable('money_moves').set({ voided_at: at, voided_by: by }).where('id', '=', id).execute();
  }

  async addGroup(group: { supplierId: number | null; placeId: number; paidOn: string; amount: number; note: string | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('payment_groups')
      .values({ supplier_id: group.supplierId, place_id: group.placeId, paid_on: group.paidOn, amount: group.amount, note: group.note, created_by: group.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async addAllocations(paymentId: number, allocations: Array<{ documentId: number | null; amount: number }>): Promise<void> {
    if (allocations.length === 0) return;
    await this.db
      .insertInto('tab_allocations')
      .values(allocations.map((allocation) => ({ payment_id: paymentId, document_id: allocation.documentId, amount: allocation.amount })))
      .execute();
  }

  /** Each till's place: the shop's under null, each carwash's under its id. */
  /** Card takings per shop day between two days, "YYYY-MM-DD" → euros. */
  async cardSalesByDay(from: string, to: string, timeZone: string): Promise<Map<string, number>> {
    const { rows } = await sql<{ day: string; amount: string }>`
      select to_char(c.day, 'YYYY-MM-DD') as day, c.amount from (${cardSalesSql(timeZone)}) c
      where c.day between ${from}::date and ${to}::date
    `.execute(this.db);
    return new Map(rows.map((row) => [row.day, Number(row.amount)]));
  }

  async tills(): Promise<Map<number | null, number>> {
    await this.ensure();
    const rows = await this.db.selectFrom('money_places').select(['id', 'carwash_id']).where('kind', '=', 'till').execute();
    return new Map(rows.map((row) => [row.carwash_id, row.id]));
  }

  /** For each cash count in the days, the money moved into (+) or out of (−) its till that day before it was counted. */
  async movesBeforeCounts(from: string, to: string): Promise<Map<number, number>> {
    const { rows } = await sql<{ id: number; net: string }>`
      select c.id, sum(case when m.to_place_id = p.id then m.amount else -m.amount end) as net
      from cash_counts c
      join money_places p on p.kind = 'till' and p.carwash_id is not distinct from c.carwash_id
      join money_moves m on m.day = c.day and m.voided_at is null and m.created_at < c.counted_at
        and (m.from_place_id = p.id or m.to_place_id = p.id)
      where c.day between ${from}::date and ${to}::date
      group by c.id
    `.execute(this.db);
    return new Map(rows.map((row) => [row.id, Number(row.net)]));
  }

  // Bank statements

  /** A record a statement line could find: the place it touched and its amount, below zero when money left the place. */
  async recordFor(kind: BankLineDoneKind, ref: number): Promise<{ placeId: number | null; amount: number } | null> {
    if (kind === 'payment') {
      const row = await this.db.selectFrom('supplier_payments').select(['place_id', 'amount', 'group_id']).where('id', '=', ref).where('voided_at', 'is', null).executeTakeFirst();
      return row && row.group_id === null ? { placeId: row.place_id, amount: -Number(row.amount) } : null;
    }
    if (kind === 'payment_group') {
      const row = await this.db
        .selectFrom('payment_groups as g')
        .innerJoin('supplier_payments as p', (join) => join.onRef('p.group_id', '=', 'g.id').on('p.voided_at', 'is', null))
        .select(['g.place_id', sql<string>`sum(p.amount)`.as('amount')])
        .where('g.id', '=', ref)
        .groupBy('g.place_id')
        .executeTakeFirst();
      return row ? { placeId: row.place_id, amount: -Number(row.amount) } : null;
    }
    if (kind === 'tab_payment') {
      const row = await this.db.selectFrom('tab_entries').select(['place_id', 'amount']).where('id', '=', ref).where('kind', '=', 'payment').executeTakeFirst();
      return row ? { placeId: row.place_id, amount: Number(row.amount) } : null;
    }
    return null;
  }

  /** A move as seen from one place: below zero when it left the place. */
  async moveFor(ref: number, placeId: number): Promise<{ placeId: number; amount: number } | null> {
    const move = await this.findMove(ref);
    if (!move || move.voided_at) return null;
    if (move.from_place_id === placeId) return { placeId, amount: -Number(move.amount) };
    if (move.to_place_id === placeId) return { placeId, amount: Number(move.amount) };
    return null;
  }

  /** Several bills paid together, taken back as one. */
  async voidGroup(groupId: number, by: number, at: Date): Promise<void> {
    await this.db.updateTable('supplier_payments').set({ voided_at: at, voided_by: by }).where('group_id', '=', groupId).where('voided_at', 'is', null).execute();
  }

  async knownFingerprints(placeId: number, fingerprints: string[]): Promise<Set<string>> {
    if (fingerprints.length === 0) return new Set();
    const rows = await this.db.selectFrom('bank_lines').select('fingerprint').where('place_id', '=', placeId).where('fingerprint', 'in', fingerprints).execute();
    return new Set(rows.map((row) => row.fingerprint));
  }

  async addStatement(statement: {
    placeId: number;
    fileName: string;
    format: 'csv' | 'xlsx' | 'pdf';
    firstDay: string | null;
    lastDay: string | null;
    openingBalance: number | null;
    closingBalance: number | null;
    linesRead: number;
    linesSkipped: number;
    uploadedBy: number;
  }): Promise<number> {
    const row = await this.db
      .insertInto('bank_statements')
      .values({
        place_id: statement.placeId,
        file_name: statement.fileName,
        format: statement.format,
        first_day: statement.firstDay,
        last_day: statement.lastDay,
        opening_balance: statement.openingBalance,
        closing_balance: statement.closingBalance,
        lines_read: statement.linesRead,
        lines_skipped: statement.linesSkipped,
        uploaded_by: statement.uploadedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async addLines(statementId: number, placeId: number, lines: Array<{ day: string; text: string; amount: number; balance: number | null; fingerprint: string; position: number }>): Promise<void> {
    if (lines.length === 0) return;
    await this.db
      .insertInto('bank_lines')
      .values(
        lines.map((line) => ({
          statement_id: statementId,
          place_id: placeId,
          day: line.day,
          text: line.text,
          amount: line.amount,
          balance: line.balance,
          fingerprint: line.fingerprint,
          position: line.position,
        })),
      )
      .onConflict((conflict) => conflict.columns(['place_id', 'fingerprint']).doNothing())
      .execute();
  }

  private lineQuery() {
    return this.db
      .selectFrom('bank_lines as l')
      .leftJoin('users as u', 'u.id', 'l.done_by')
      .select([
        'l.id',
        'l.statement_id',
        'l.place_id',
        sql<string>`to_char(l.day, 'YYYY-MM-DD')`.as('day'),
        'l.text',
        'l.amount',
        'l.balance',
        'l.position',
        'l.status',
        'l.done_kind',
        'l.done_ref',
        'l.made_record',
        'l.rule_id',
        'u.name as done_by_name',
        'l.done_at',
      ]);
  }

  /** A place's lines: open ones first, then the newest. */
  lines(placeId: number, status: BankLineStatus | 'all', limit = 500): Promise<BankLineRecord[]> {
    let query = this.lineQuery().where('l.place_id', '=', placeId);
    if (status !== 'all') query = query.where('l.status', '=', status);
    return query
      .orderBy(sql`l.status = 'open'`, 'desc')
      .orderBy('l.day', 'desc')
      .orderBy('l.statement_id', 'desc')
      .orderBy('l.position', 'desc')
      .limit(limit)
      .execute();
  }

  /** One line, locked for the change about to be made. */
  async lockLine(id: number): Promise<BankLineRecord> {
    await sql`select id from bank_lines where id = ${id} for update`.execute(this.db);
    const line = await this.lineQuery().where('l.id', '=', id).executeTakeFirst();
    if (!line) throw new NotFoundError(`Bank line ${id} does not exist`);
    return line;
  }

  async markDone(id: number, done: { kind: BankLineDoneKind; ref: number; madeRecord: boolean; ruleId: number | null; by: number; at: Date }): Promise<void> {
    await this.db
      .updateTable('bank_lines')
      .set({ status: 'done', done_kind: done.kind, done_ref: done.ref, made_record: done.madeRecord, rule_id: done.ruleId, done_by: done.by, done_at: done.at })
      .where('id', '=', id)
      .execute();
  }

  async markStatus(id: number, status: 'open' | 'skipped', by: number, at: Date): Promise<void> {
    const open = status === 'open';
    await this.db
      .updateTable('bank_lines')
      .set({ status, done_kind: null, done_ref: null, made_record: false, rule_id: null, done_by: open ? null : by, done_at: open ? null : at })
      .where('id', '=', id)
      .execute();
  }

  /** The records of a kind statement lines already found or made. */
  async linkedRefs(kind: BankLineDoneKind): Promise<Set<number>> {
    const rows = await this.db.selectFrom('bank_lines').select('done_ref').where('status', '=', 'done').where('done_kind', '=', kind).execute();
    return new Set(rows.map((row) => row.done_ref!));
  }

  statements(placeId: number) {
    return this.db
      .selectFrom('bank_statements as s')
      .leftJoin('users as u', 'u.id', 's.uploaded_by')
      .select([
        's.id',
        's.file_name',
        's.format',
        sql<string | null>`to_char(s.first_day, 'YYYY-MM-DD')`.as('first_day'),
        sql<string | null>`to_char(s.last_day, 'YYYY-MM-DD')`.as('last_day'),
        's.opening_balance',
        's.closing_balance',
        's.lines_read',
        's.lines_skipped',
        'u.name as uploaded_by_name',
        's.uploaded_at',
      ])
      .where('s.place_id', '=', placeId)
      .orderBy(sql`s.last_day desc nulls last`)
      .orderBy('s.id', 'desc')
      .limit(50)
      .execute();
  }

  rules(): Promise<BankRuleRecord[]> {
    return this.db
      .selectFrom('bank_rules as r')
      .leftJoin('suppliers as s', 's.id', 'r.supplier_id')
      .select(['r.id', 'r.place_id', 'r.contains', 'r.direction', 'r.action', 'r.category', 'r.supplier_id', 's.name as supplier_name', 'r.other_place_id', 'r.created_at'])
      .orderBy('r.contains')
      .execute();
  }

  findRule(id: number) {
    return this.db.selectFrom('bank_rules').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async addRule(rule: RuleFields, createdBy: number): Promise<number> {
    const row = await this.db
      .insertInto('bank_rules')
      .values({
        place_id: rule.placeId,
        contains: rule.contains,
        direction: rule.direction,
        action: rule.action,
        category: rule.category,
        supplier_id: rule.supplierId,
        other_place_id: rule.otherPlaceId,
        created_by: createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateRule(id: number, rule: RuleFields): Promise<void> {
    await this.db
      .updateTable('bank_rules')
      .set({
        place_id: rule.placeId,
        contains: rule.contains,
        direction: rule.direction,
        action: rule.action,
        category: rule.category,
        supplier_id: rule.supplierId,
        other_place_id: rule.otherPlaceId,
      })
      .where('id', '=', id)
      .execute();
  }

  async removeRule(id: number): Promise<void> {
    await this.db.deleteFrom('bank_rules').where('id', '=', id).execute();
  }
}
