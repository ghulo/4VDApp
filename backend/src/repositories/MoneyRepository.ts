import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { accountForPlace, ensurePlaces } from '../database/places.js';
import type { BankLineDoneKind, MoneyPlaceKind, SupplierPaymentMethod } from '../database/types.js';
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

/** The places money is kept and the moves between them. */
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
}
