import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { MoneyPlaceKind } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { cardSalesSql, type MoneyRepository, type PlaceRecord, placeWords } from '../repositories/MoneyRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { CashCountService } from './CashCountService.js';
import { payBill } from './SupplierBillService.js';
import { assertMonthsOpen } from './vat/periodLock.js';

export interface PlaceDto {
  id: number;
  kind: MoneyPlaceKind;
  /** Its own name, else its carwash's; null for the shop's till and an unnamed safe (the screens say their usual name). */
  name: string | null;
  carwashId: number | null;
  bankName: string | null;
  iban: string | null;
  account: { id: number; number: string; name: string } | null;
  /** The safe or bank account a payment goes to when only "cash" or "bank" is said. */
  isDefault: boolean;
  /** A carwash's till: like the carwash's bills, it is outside the books for now. */
  inBooks: boolean;
  openingBalance: number;
  openingDay: string | null;
  /** What 4VD says is in it today. */
  balance: number;
  archived: boolean;
  /** Bank statement lines still to match. */
  openLines: number;
  lastStatement: { lastDay: string | null; closingBalance: number | null } | null;
}

export type BookLineKind = 'takings' | 'card' | 'carwash' | 'customer' | 'supplier' | 'group' | 'move' | 'customs' | 'count';

export interface BookLineDto {
  day: string;
  kind: BookLineKind;
  /** The record behind it: a payment, a group, a tab entry, a move, a bill or a count. */
  refId: number | null;
  /** Money in is above zero, money out below; 0 on a count. */
  amount: number;
  balance: number;
  /** A customer or supplier; for a move, the other place (null: the owner). */
  party: { id: number; name: string } | null;
  otherPlace: { id: number; kind: MoneyPlaceKind; name: string | null } | null;
  /** A bill's number, or how many bills a group paid. */
  detail: string | null;
  bills: number | null;
  billId: number | null;
  note: string | null;
  /** On a count: what was counted and how it compared with the day's takings. */
  count: { counted: number; difference: number | null } | null;
}

export interface PlaceBookDto {
  place: PlaceDto;
  from: string;
  to: string;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
  lines: BookLineDto[];
}

export interface MoveInput {
  day: string;
  amount: number;
  /** Null: the owner put the money in. */
  fromPlaceId: number | null;
  /** Null: the owner took the money out. */
  toPlaceId: number | null;
  note: string | null;
}

export interface PayBillsInput {
  supplierId: number;
  placeId: number;
  paidOn: string;
  note: string | null;
  bills: Array<{ billId: number; amount: number }>;
}

export interface PlaceInput {
  kind: 'bank' | 'safe';
  name: string;
  bankName: string | null;
  iban: string | null;
  openingBalance: number;
  openingDay: string | null;
}

export interface PlaceChanges {
  name?: string;
  bankName?: string | null;
  iban?: string | null;
  openingBalance?: number;
  openingDay?: string | null;
  makeDefault?: boolean;
  archived?: boolean;
}

/** An IBAN with its check digits right (ISO 13616): letters to numbers, mod 97 is 1. */
export function validIban(iban: string): boolean {
  const compact = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  let rest = 0;
  for (const char of moved) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

const KIND_ORDER: Record<BookLineKind, number> = { takings: 0, card: 0, carwash: 0, customer: 1, customs: 2, supplier: 2, group: 2, move: 3, count: 4 };

/**
 * Every movement of money into or out of every place, read from the records
 * themselves: a till's takings per day (sales less what went on a tab or a
 * card, returns paid back), card takings into the bank, customers' payments,
 * suppliers paid, customs paid at the border, carwash takings and money moved.
 * The books post the same records.
 */
const movementsSql = (timeZone: string) => sql`
  with shop as (select id from money_places where kind = 'till' and carwash_id is null),
  bank as (select id from money_places where kind = 'bank' and is_default),
  -- Sales paid by card went to the bank through its card terminal, not into the drawer.
  card as (${cardSalesSql(timeZone)}),
  takings as (
    select day, sum(amount) as amount from (
      select (l.occurred_at at time zone ${timeZone})::date as day, l.revenue as amount from sales_ledger l
      union all
      select (e.occurred_at at time zone ${timeZone})::date, case when e.kind = 'charge' then -e.amount else e.amount end
      from tab_entries e left join sales s on s.id = e.sale_id left join returns r on r.id = e.return_id
      where e.kind <> 'payment' and (e.sale_id is null or s.undone_at is null) and (e.return_id is null or r.undone_at is null)
      union all
      select day, -amount from card
    ) t group by day
  )
  select (select id from shop) as place_id, day, 'takings' as kind, null::int as ref_id, amount, null::int as party_id, null::text as party_name,
    null::int as other_place_id, null::text as detail, null::int as bills, null::int as bill_id, null::text as note
  from takings where amount <> 0
  union all
  select (select id from bank), day, 'card', null, amount, null, null, null, null, null, null, null
  from card where amount <> 0
  union all
  select cp.id, d.day, 'carwash', null, d.carwash_amount + d.change_amount, null, null, null, null, null, null, null
  from carwash_days d join money_places cp on cp.carwash_id = d.carwash_id
  where d.carwash_amount + d.change_amount <> 0
  union all
  select coalesce(e.place_id, (select id from shop)), (e.occurred_at at time zone ${timeZone})::date, 'customer', e.id, e.amount, c.id, c.name,
    null, null, null, null, e.note
  from tab_entries e join customers c on c.id = e.customer_id
  where e.kind = 'payment'
  union all
  select p.place_id, p.paid_on, 'supplier', p.id, -p.amount, s.id, s.name, null, b.number, null, b.id, p.note
  from supplier_payments p join supplier_bills b on b.id = p.bill_id left join suppliers s on s.id = b.supplier_id
  where p.voided_at is null and p.method <> 'credit' and p.group_id is null
  union all
  select min(p.place_id), min(p.paid_on), 'group', g.id, -sum(p.amount), s.id, s.name, null, null, count(*)::int, null, g.note
  from supplier_payments p join payment_groups g on g.id = p.group_id left join suppliers s on s.id = g.supplier_id
  where p.voided_at is null and p.group_id is not null
  group by g.id, s.id, s.name, g.note
  union all
  select case when b.customs_paid_method = 'cash' then (select id from shop) else (select id from bank) end, b.issued_on, 'customs', b.id,
    -(coalesce(b.customs_vat, 0) + coalesce(b.customs_duty, 0)), s.id, s.name, null, b.number, null, b.id, null
  from supplier_bills b left join suppliers s on s.id = b.supplier_id
  where b.voided_at is null and b.customs_paid_method is not null and coalesce(b.customs_vat, 0) + coalesce(b.customs_duty, 0) > 0
  union all
  select m.from_place_id, m.day, 'move', m.id, -m.amount, null, null, m.to_place_id, null, null, null, m.note
  from money_moves m where m.voided_at is null and m.from_place_id is not null
  union all
  select m.to_place_id, m.day, 'move', m.id, m.amount, null, null, m.from_place_id, null, null, null, m.note
  from money_moves m where m.voided_at is null and m.to_place_id is not null
`;

interface MovementRow {
  place_id: number;
  day: string;
  kind: Exclude<BookLineKind, 'count'>;
  ref_id: number | null;
  amount: string;
  party_id: number | null;
  party_name: string | null;
  other_place_id: number | null;
  detail: string | null;
  bills: number | null;
  bill_id: number | null;
  note: string | null;
}

/**
 * Every place money is kept, what is in each, and how money moves between
 * them: one book per place (TREFIN's cash and bank card and day book), one
 * form for every move, and one payment over several bills.
 */
export class MoneyService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly moneyRepository: MoneyRepository,
    private readonly cashCountService: CashCountService,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  today(now = new Date()): string {
    return zonedDay(now, this.timeZone);
  }

  /** Each place's balance up to and including a day (null: everything). */
  private async balances(upTo: string | null): Promise<Map<number, number>> {
    const { rows } = await sql<{ place_id: number; total: string }>`
      select mv.place_id, sum(mv.amount) as total
      from (${movementsSql(this.timeZone)}) mv join money_places p on p.id = mv.place_id
      where (p.opening_day is null or mv.day >= p.opening_day) and (${upTo}::date is null or mv.day <= ${upTo}::date)
      group by mv.place_id
    `.execute(this.db);
    return new Map(rows.map((row) => [row.place_id, Number(row.total)]));
  }

  private async toDtos(records: PlaceRecord[], now: Date): Promise<PlaceDto[]> {
    const [balances, lines, statements] = await Promise.all([
      this.balances(this.today(now)),
      this.db.selectFrom('bank_lines').select(['place_id', sql<string>`count(*)`.as('open')]).where('status', '=', 'open').groupBy('place_id').execute(),
      sql<{ place_id: number; last_day: string | null; closing_balance: string | null }>`
        select distinct on (place_id) place_id, to_char(last_day, 'YYYY-MM-DD') as last_day, closing_balance
        from bank_statements order by place_id, last_day desc nulls last, id desc
      `.execute(this.db),
    ]);
    return records.map((place) => {
      const statement = statements.rows.find((row) => row.place_id === place.id);
      return {
        id: place.id,
        kind: place.kind,
        name: place.name ?? place.carwash_name,
        carwashId: place.carwash_id,
        bankName: place.bank_name,
        iban: place.iban,
        account: place.account_id === null ? null : { id: place.account_id, number: place.account_number!, name: place.account_name! },
        isDefault: place.is_default,
        inBooks: place.carwash_id === null,
        openingBalance: Number(place.opening_balance),
        openingDay: place.opening_day,
        balance: roundMoney(Number(place.opening_balance) + (balances.get(place.id) ?? 0)),
        archived: place.archived_at !== null,
        openLines: Number(lines.find((row) => row.place_id === place.id)?.open ?? 0),
        lastStatement: statement ? { lastDay: statement.last_day, closingBalance: statement.closing_balance === null ? null : Number(statement.closing_balance) } : null,
      };
    });
  }

  async places(now = new Date()): Promise<PlaceDto[]> {
    return this.toDtos(await this.moneyRepository.places(), now);
  }

  async place(id: number, now = new Date()): Promise<PlaceDto> {
    const [dto] = await this.toDtos([await this.moneyRepository.placeOrThrow(id)], now);
    return dto!;
  }

  /** What 4VD says was in a place at the end of a day. */
  async balanceOn(placeId: number, day: string): Promise<number> {
    const place = await this.moneyRepository.placeOrThrow(placeId);
    const balances = await this.balances(day);
    return roundMoney(Number(place.opening_balance) + (balances.get(placeId) ?? 0));
  }

  /** One place's book for a period: every movement with a running balance, and a till's counts. */
  async book(placeId: number, period: { from: string; to: string }, now = new Date()): Promise<PlaceBookDto> {
    const place = await this.place(placeId, now);
    const start = place.openingDay !== null && place.openingDay > period.from ? place.openingDay : period.from;
    const { rows } = await sql<MovementRow>`
      select mv.place_id, to_char(mv.day, 'YYYY-MM-DD') as day, mv.kind, mv.ref_id, mv.amount, mv.party_id, mv.party_name,
        mv.other_place_id, mv.detail, mv.bills, mv.bill_id, mv.note
      from (${movementsSql(this.timeZone)}) mv
      where mv.place_id = ${placeId} and mv.day between ${start}::date and ${period.to}::date
    `.execute(this.db);
    const before = await sql<{ total: string | null }>`
      select sum(mv.amount) as total from (${movementsSql(this.timeZone)}) mv
      where mv.place_id = ${placeId} and mv.day < ${start}::date and (${place.openingDay}::date is null or mv.day >= ${place.openingDay}::date)
    `.execute(this.db);
    const opening = roundMoney(place.openingBalance + Number(before.rows[0]?.total ?? 0));

    const others = new Map((await this.places(now)).map((other) => [other.id, other]));
    const counts =
      place.kind === 'till'
        ? (await this.cashCountService.list({ startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${period.to}T23:59:59Z`) })).filter(
            (count) => count.day >= start && count.day <= period.to && (place.carwashId === null ? count.place === 'shop' : count.carwashId === place.carwashId),
          )
        : [];

    const lines: Array<Omit<BookLineDto, 'balance'>> = [
      ...rows.map((row) => {
        const other = row.other_place_id === null ? null : others.get(row.other_place_id);
        return {
          day: row.day,
          kind: row.kind,
          refId: row.ref_id,
          amount: Number(row.amount),
          party: row.party_id === null ? null : { id: row.party_id, name: row.party_name ?? '' },
          otherPlace: other ? { id: other.id, kind: other.kind, name: other.name } : null,
          detail: row.detail,
          bills: row.bills,
          billId: row.bill_id,
          note: row.note,
          count: null,
        };
      }),
      ...counts.map((count) => ({
        day: count.day,
        kind: 'count' as const,
        refId: count.id,
        amount: 0,
        party: null,
        otherPlace: null,
        detail: null,
        bills: null,
        billId: null,
        note: count.note,
        count: { counted: count.counted, difference: count.difference },
      })),
    ];
    lines.sort((a, b) => a.day.localeCompare(b.day) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.refId ?? 0) - (b.refId ?? 0));

    let balance = opening;
    let moneyIn = 0;
    let moneyOut = 0;
    const withBalance = lines.map((line) => {
      balance = roundMoney(balance + line.amount);
      if (line.amount > 0) moneyIn = roundMoney(moneyIn + line.amount);
      else moneyOut = roundMoney(moneyOut - line.amount);
      return { ...line, balance };
    });
    return { place, from: start, to: period.to, opening, moneyIn, moneyOut, closing: balance, lines: withBalance };
  }

  /** A new bank account or safe, with its own account in the books. */
  async addPlace(input: PlaceInput, actorId: number): Promise<PlaceDto> {
    if (input.iban && !validIban(input.iban)) throw new ValidationError("That IBAN doesn't look right: check the letters and numbers");
    const id = await this.transactions.run(async (repos) => {
      await repos.money.ensure();
      const accountId = await repos.money.newAccount(input.kind, input.name);
      const placeId =
        input.kind === 'bank'
          ? await repos.money.addBank({ ...input, iban: input.iban?.replace(/\s+/g, '').toUpperCase() ?? null, accountId, createdBy: actorId })
          : await repos.money.addSafe({ ...input, accountId, createdBy: actorId });
      const place = await repos.money.placeOrThrow(placeId);
      await repos.activityLog.create({
        userId: actorId,
        action: 'money.place_added',
        entityType: 'money_place',
        entityId: placeId,
        say: { key: 'placeAdded', params: { place: placeWords(place) } },
        details: { ...input },
      });
      return placeId;
    });
    return this.place(id);
  }


  async updatePlace(id: number, changes: PlaceChanges, actorId: number, now = new Date()): Promise<PlaceDto> {
    const before = await this.place(id, now);
    if (changes.iban && !validIban(changes.iban)) throw new ValidationError("That IBAN doesn't look right: check the letters and numbers");
    if (before.kind === 'till' && (changes.archived || changes.makeDefault || changes.bankName !== undefined || changes.iban !== undefined)) {
      throw new ValidationError("A till comes and goes with its shop or carwash; only its name can change");
    }
    if (changes.archived && Math.abs(before.balance) >= 0.01) {
      throw new ConflictError(`${formatEuro(before.balance)} is still in it. Move it to another place first.`);
    }
    if (changes.archived && before.isDefault) throw new ConflictError('Make another one the main one first');
    await this.transactions.run(async (repos) => {
      if (changes.makeDefault && before.kind !== 'till') await repos.money.clearDefault(before.kind);
      await repos.money.updatePlace(id, {
        ...(changes.name !== undefined && { name: changes.name.trim() || null }),
        ...(changes.bankName !== undefined && { bank_name: changes.bankName }),
        ...(changes.iban !== undefined && { iban: changes.iban?.replace(/\s+/g, '').toUpperCase() ?? null }),
        ...(changes.openingBalance !== undefined && { opening_balance: changes.openingBalance }),
        ...(changes.openingDay !== undefined && { opening_day: changes.openingDay }),
        ...(changes.makeDefault && { is_default: true }),
        ...(changes.archived !== undefined && { archived_at: changes.archived ? now : null }),
      });
      const place = await repos.money.placeOrThrow(id);
      await repos.activityLog.create({
        userId: actorId,
        action: changes.archived ? 'money.place_closed' : 'money.place_changed',
        entityType: 'money_place',
        entityId: id,
        say: { key: changes.archived ? 'placeClosed' : 'placeChanged', params: { place: placeWords(place) } },
        details: { before: { name: before.name, bankName: before.bankName, iban: before.iban, openingBalance: before.openingBalance, openingDay: before.openingDay }, after: changes },
      });
    });
    return this.place(id, now);
  }

  /** Money taken from one place to another, or put in or taken out by the owner. */
  async move(input: MoveInput, actorId: number, now = new Date()): Promise<{ id: number }> {
    const id = await this.transactions.run((repos) => addMove(repos, input, actorId, this.today(now)));
    return { id };
  }

  /** A move made by mistake: kept, crossed out, and its entry in the books reversed. */
  async voidMove(id: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      const move = await repos.money.findMove(id);
      if (!move) throw new NotFoundError(`Move ${id} does not exist`);
      if (move.voided_at) throw new ConflictError('This move was already removed');
      const linked = await repos.money.lineFor('move', id);
      if (linked) throw new ConflictError('This move came from a bank statement line. Take that match back instead.');
      await assertMonthsOpen(repos.periods, [move.day]);
      await repos.money.voidMove(id, actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'money.move_removed',
        entityType: 'money_move',
        entityId: id,
        say: { key: 'moveRemoved', params: await moveWords(repos, Number(move.amount), move.from_place_id, move.to_place_id) },
        details: {},
      });
    });
  }

  /** One payment over several of a supplier's bills, from one place. */
  async payBills(input: PayBillsInput, actorId: number, now = new Date()): Promise<{ groupId: number }> {
    if (input.paidOn > this.today(now)) throw new ValidationError("A payment can't be dated in the future");
    const groupId = await this.transactions.run((repos) => payBillsTogether(repos, input, actorId));
    return { groupId };
  }
}

async function moveWords(repos: TransactionalRepositories, amount: number, fromId: number | null, toId: number | null) {
  const from = fromId === null ? null : placeWords(await repos.money.placeOrThrow(fromId));
  const to = toId === null ? null : placeWords(await repos.money.placeOrThrow(toId));
  return { amount, from, to };
}

/** Record a move inside a transaction. Returns its id. */
export async function addMove(repos: TransactionalRepositories, input: MoveInput, actorId: number, today: string): Promise<number> {
  if (input.fromPlaceId === null && input.toPlaceId === null) throw new ValidationError('Say where the money comes from or goes to');
  if (input.fromPlaceId !== null && input.fromPlaceId === input.toPlaceId) throw new ValidationError('The money has to go somewhere else');
  if (input.day > today) throw new ValidationError("A move can't be dated in the future");
  await assertMonthsOpen(repos.periods, [input.day]);
  for (const placeId of [input.fromPlaceId, input.toPlaceId]) {
    if (placeId === null) continue;
    const place = await repos.money.placeOrThrow(placeId);
    if (place.archived_at) throw new ValidationError('That place is closed; pick another');
  }
  const id = await repos.money.addMove({ ...input, createdBy: actorId });
  await repos.activityLog.create({
    userId: actorId,
    action: 'money.moved',
    entityType: 'money_move',
    entityId: id,
    say: { key: 'moneyMoved', params: await moveWords(repos, input.amount, input.fromPlaceId, input.toPlaceId) },
    details: { ...input },
  });
  return id;
}

/** Pay several bills of one supplier as one payment, inside a transaction. Returns the group's id. */
export async function payBillsTogether(repos: TransactionalRepositories, input: PayBillsInput, actorId: number): Promise<number> {
  const bills = input.bills.filter((bill) => bill.amount > 0);
  if (bills.length === 0) throw new ValidationError('Tick at least one bill to pay');
  if (new Set(bills.map((bill) => bill.billId)).size !== bills.length) throw new ValidationError('A bill is ticked twice');
  const amount = roundMoney(bills.reduce((sum, bill) => sum + bill.amount, 0));
  const supplier = await repos.orders.findSupplier(input.supplierId);
  if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} does not exist`);
  const place = await repos.money.placeOrThrow(input.placeId);
  const groupId = await repos.money.addGroup({ supplierId: input.supplierId, placeId: input.placeId, paidOn: input.paidOn, amount, note: input.note, createdBy: actorId });
  for (const bill of bills) {
    await payBill(repos, bill.billId, { amount: bill.amount, paidOn: input.paidOn, placeId: input.placeId, note: input.note, groupId, supplierId: input.supplierId }, actorId);
  }
  await repos.activityLog.create({
    userId: actorId,
    action: 'bill.paid_together',
    entityType: 'supplier',
    entityId: input.supplierId,
    say: { key: 'billsPaidTogether', params: { supplier: supplier.name, amount, bills: bills.length, from: placeWords(place) } },
    details: { groupId, ...input },
  });
  return groupId;
}
