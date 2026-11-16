import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/httpErrors.js';
import { ActivityLogRepository } from '../../repositories/ActivityLogRepository.js';
import { VatMonthRepository } from '../../repositories/VatMonthRepository.js';
import { roundMoney } from '../../utils/money.js';
import { zonedDay } from '../../utils/zonedDates.js';
import { monthEnd } from '../assets/depreciation.js';
import { assertMonthsOpen } from '../vat/periodLock.js';
import { type LeaveBalance, leaveBalance, workingDays } from './leave.js';
import { dueDayOf, grossFromNet, type PayResult, payFromGross, type PayrollRules, rulesFor, type TaxPart } from './payrollRules.js';

export type Contract = 'open' | 'fixed' | 'part_time';
export type Place = 'shop' | 'carwash';

export interface EmployeeInput {
  userId: number | null;
  name: string;
  personalNumber: string | null;
  jobTitle: string | null;
  contract: Contract;
  startedOn: string;
  contractEndsOn: string | null;
  leftOn: string | null;
  payBasis: 'gross' | 'net';
  payAmount: number;
  secondary: boolean;
  nonResident: boolean;
  extraPensionEmployee: number;
  extraPensionEmployer: number;
  bankAccount: string | null;
  bankName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birthDate: string | null;
  place: Place;
  leaveDays: number;
  note: string | null;
}

export interface EmployeeDto extends EmployeeInput {
  id: number;
  userName: string | null;
  /** The gross a month would start from (net worked back for a net contract); null before 4VD knows the rules. */
  monthlyGross: number | null;
  leave: LeaveBalance;
  /** Has left (or leaves today or earlier). */
  gone: boolean;
}

export interface LeaveEntryDto {
  id: number;
  kind: 'taken' | 'adjust';
  from: string;
  to: string;
  days: number;
  note: string | null;
}

export interface PayslipRef {
  monthId: number;
  month: string;
  gross: number;
  net: number;
}

export interface EmployeeDetailDto extends EmployeeDto {
  leaveEntries: LeaveEntryDto[];
  payslips: PayslipRef[];
}

/** Something on a line the person running the month should see; never blocks. */
export type LineWarning =
  | { key: 'belowMinimum'; minimum: number }
  | { key: 'partMonth'; startedOn: string | null; leftOn: string | null }
  | { key: 'leaveOwed'; days: number }
  | { key: 'noPersonalNumber' };

export interface PreviewLine extends PayResult {
  employeeId: number;
  name: string;
  personalNumber: string | null;
  place: Place;
  secondary: boolean;
  nonResident: boolean;
  /** What the contract gives for the month, before any change. */
  contractGross: number;
  payBasis: 'gross' | 'net';
  changedReason: string | null;
  warnings: LineWarning[];
}

export interface Totals {
  people: number;
  gross: number;
  employeePension: number;
  employerPension: number;
  tax: number;
  net: number;
  /** Gross plus the employer's pension: what the month costs the business. */
  cost: number;
  /** Wage tax and both pension shares: paid to ATK by the due day. */
  toAtk: number;
  carwashGross: number;
}

export interface PreviewDto {
  month: string;
  dueOn: string;
  lines: PreviewLine[];
  totals: Totals;
  /** Set when the month is already confirmed. */
  confirmedId: number | null;
}

export interface PaymentDto {
  id: number;
  kind: 'wages' | 'tax' | 'pension';
  placeId: number;
  placeName: string | null;
  placeKind: string;
  paidOn: string;
  amount: number;
  carwashAmount: number;
  employeeIds: number[];
  note: string | null;
}

export interface MonthDto {
  id: number;
  month: string;
  dueOn: string;
  confirmedAt: string;
  confirmedBy: string | null;
  totals: Totals;
  /** Net pay still to pay, and the wage tax and pension still to pay ATK. */
  wagesLeft: number;
  taxLeft: number;
  pensionLeft: number;
}

export interface MonthDetailDto extends MonthDto {
  lines: PreviewLine[];
  payments: PaymentDto[];
  /** Net still owed to each person. */
  unpaid: Array<{ employeeId: number; amount: number }>;
}

export interface LineChange {
  employeeId: number;
  gross: number;
  reason: string;
}

export interface PayslipData {
  business: { name: string; nui: string | null };
  month: string;
  employee: { name: string; personalNumber: string | null; jobTitle: string | null; bankAccount: string | null; startedOn: string };
  line: PreviewLine;
  leave: LeaveBalance;
  paidOn: string | null;
}

type EmployeeRow = Awaited<ReturnType<typeof employeeQuery>>[number];

function employeeQuery(db: DatabaseClient) {
  return db
    .selectFrom('employees as e')
    .leftJoin('users as u', 'u.id', 'e.user_id')
    .select([
      'e.id',
      'e.user_id',
      'u.name as user_name',
      'e.name',
      'e.personal_number',
      'e.job_title',
      'e.contract',
      sql<string>`to_char(e.started_on, 'YYYY-MM-DD')`.as('started_on'),
      sql<string | null>`to_char(e.contract_ends_on, 'YYYY-MM-DD')`.as('contract_ends_on'),
      sql<string | null>`to_char(e.left_on, 'YYYY-MM-DD')`.as('left_on'),
      'e.pay_basis',
      'e.pay_amount',
      'e.secondary',
      'e.non_resident',
      'e.extra_pension_employee',
      'e.extra_pension_employer',
      'e.bank_account',
      'e.bank_name',
      'e.phone',
      'e.email',
      'e.address',
      sql<string | null>`to_char(e.birth_date, 'YYYY-MM-DD')`.as('birth_date'),
      'e.place',
      'e.leave_days',
      'e.note',
    ])
    .execute();
}

const monthStart = (month: string) => `${month.slice(0, 7)}-01`;
const sumOf = <T>(rows: T[], value: (row: T) => number) => roundMoney(rows.reduce((total, row) => total + value(row), 0));

function totalsOf(lines: Array<PayResult & { place: Place }>): Totals {
  const tax = sumOf(lines, (line) => line.tax);
  const employeePension = sumOf(lines, (line) => line.employeePension);
  const employerPension = sumOf(lines, (line) => line.employerPension);
  return {
    people: lines.length,
    gross: sumOf(lines, (line) => line.gross),
    employeePension,
    employerPension,
    tax,
    net: sumOf(lines, (line) => line.net),
    cost: sumOf(lines, (line) => line.cost),
    toAtk: roundMoney(tax + employeePension + employerPension),
    carwashGross: sumOf(
      lines.filter((line) => line.place === 'carwash'),
      (line) => line.gross,
    ),
  };
}

/**
 * The payroll: who is on it, a month worked out line by line and confirmed
 * once (which posts the books entry), wages and ATK paid from a place money is
 * kept, payslips, the declaration file and annual leave. Pay is seen only by
 * those with the payroll power (the owner and the accountant), and each person
 * sees their own payslips and leave.
 */
export class PayrollService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly timeZone: string,
    /** Brings the books up to date after a change. */
    private readonly syncBooks: () => Promise<void>,
  ) {}

  today(now = new Date()): string {
    return zonedDay(now, this.timeZone);
  }

  // ---------- Employees ----------

  private async leaveEntries(employeeIds: number[]): Promise<Map<number, LeaveEntryDto[]>> {
    const map = new Map<number, LeaveEntryDto[]>();
    if (employeeIds.length === 0) return map;
    const rows = await this.db
      .selectFrom('leave_entries')
      .select(['id', 'employee_id', 'kind', 'days', 'note', sql<string>`to_char(from_day, 'YYYY-MM-DD')`.as('from_day'), sql<string>`to_char(to_day, 'YYYY-MM-DD')`.as('to_day')])
      .where('employee_id', 'in', employeeIds)
      .orderBy('from_day', 'desc')
      .orderBy('id', 'desc')
      .execute();
    for (const row of rows) {
      const list = map.get(row.employee_id) ?? [];
      list.push({ id: row.id, kind: row.kind, from: row.from_day, to: row.to_day, days: Number(row.days), note: row.note });
      map.set(row.employee_id, list);
    }
    return map;
  }

  private toDto(row: EmployeeRow, entries: LeaveEntryDto[], today: string): EmployeeDto {
    const input = toInput(row);
    const rules = rulesFor(monthStart(today));
    return {
      ...input,
      id: row.id,
      userName: row.user_name,
      monthlyGross: rules ? contractGross(input, rules) : null,
      leave: leaveBalance({ leaveDays: input.leaveDays, startedOn: input.startedOn, leftOn: input.leftOn }, entries, today),
      gone: input.leftOn !== null && input.leftOn < today,
    };
  }

  async list(now = new Date()): Promise<EmployeeDto[]> {
    const today = this.today(now);
    const rows = await employeeQuery(this.db);
    const entries = await this.leaveEntries(rows.map((row) => row.id));
    return rows
      .map((row) => this.toDto(row, entries.get(row.id) ?? [], today))
      .sort((a, b) => Number(a.gone) - Number(b.gone) || a.name.localeCompare(b.name));
  }

  async get(id: number, now = new Date()): Promise<EmployeeDetailDto> {
    const today = this.today(now);
    const row = (await employeeQuery(this.db)).find((one) => one.id === id);
    if (!row) throw new NotFoundError(`Employee ${id} does not exist`);
    const entries = (await this.leaveEntries([id])).get(id) ?? [];
    const payslips = await this.db
      .selectFrom('payroll_lines as l')
      .innerJoin('payroll_months as m', 'm.id', 'l.month_id')
      .select(['m.id', sql<string>`to_char(m.month, 'YYYY-MM-DD')`.as('month'), 'l.gross', 'l.net'])
      .where('l.employee_id', '=', id)
      .where('m.voided_at', 'is', null)
      .orderBy('m.month', 'desc')
      .execute();
    return {
      ...this.toDto(row, entries, today),
      leaveEntries: entries,
      payslips: payslips.map((slip) => ({ monthId: slip.id, month: slip.month, gross: Number(slip.gross), net: Number(slip.net) })),
    };
  }

  /** Team accounts that can be linked to someone on the payroll, with the email and phone that fill in their details. */
  async team(): Promise<Array<{ id: number; name: string; role: string; email: string; phone: string | null }>> {
    return this.db.selectFrom('users').select(['id', 'name', 'role', 'email', 'phone']).where('is_active', '=', true).where('deleted_at', 'is', null).where('role', '!=', 'developer').orderBy('name').execute();
  }

  /** The employee record linked to a team account, if any. */
  async idForUser(userId: number): Promise<number | null> {
    const row = await this.db.selectFrom('employees').select('id').where('user_id', '=', userId).executeTakeFirst();
    return row?.id ?? null;
  }

  private check(input: EmployeeInput): void {
    if (input.contractEndsOn && input.contractEndsOn < input.startedOn) throw new ValidationError('contractEndsOn: the contract can’t end before it starts');
    if (input.leftOn && input.leftOn < input.startedOn) throw new ValidationError('leftOn: they can’t leave before they start');
    const rules = rulesFor(monthStart(input.startedOn)) ?? rulesFor('9999-12-01')!;
    const top = rules.maxPensionEachSide;
    if (rules.employeePension + input.extraPensionEmployee > top || rules.employerPension + input.extraPensionEmployer > top)
      throw new ValidationError(`extraPension: each side pays at most ${top}% in all`);
  }

  async create(input: EmployeeInput, actorId: number, now = new Date()): Promise<EmployeeDetailDto> {
    this.check(input);
    const id = await this.db.transaction().execute(async (trx) => {
      await this.checkUser(trx, input.userId, null);
      const row = await trx.insertInto('employees').values({ ...toRow(input), created_by: actorId }).returning('id').executeTakeFirstOrThrow();
      // No personal number or bank account in the log: it is read by more people than the payroll is.
      await new ActivityLogRepository(trx).create({ userId: actorId, action: 'employee.created', entityType: 'employee', entityId: row.id, say: { key: 'employeeAdded', params: { name: input.name } } });
      return row.id;
    });
    return this.get(id, now);
  }

  async update(id: number, input: EmployeeInput, actorId: number, now = new Date()): Promise<EmployeeDetailDto> {
    this.check(input);
    await this.db.transaction().execute(async (trx) => {
      const found = await trx.selectFrom('employees').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!found) throw new NotFoundError(`Employee ${id} does not exist`);
      await this.checkUser(trx, input.userId, id);
      await trx.updateTable('employees').set(toRow(input)).where('id', '=', id).execute();
      await new ActivityLogRepository(trx).create({ userId: actorId, action: 'employee.updated', entityType: 'employee', entityId: id, say: { key: 'employeeEdited', params: { name: input.name } } });
    });
    return this.get(id, now);
  }

  private async checkUser(db: DatabaseClient, userId: number | null, self: number | null): Promise<void> {
    if (userId === null) return;
    const user = await db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst();
    if (!user) throw new ValidationError('userId: that team account does not exist');
    const taken = await db.selectFrom('employees').select('id').where('user_id', '=', userId).executeTakeFirst();
    if (taken && taken.id !== self) throw new ConflictError('That team account is already linked to someone on the payroll');
  }

  // ---------- Leave ----------

  async addLeave(employeeId: number, input: { kind: 'taken' | 'adjust'; from: string; to: string; days: number | null; note: string | null }, actorId: number, now = new Date()): Promise<EmployeeDetailDto> {
    if (input.to < input.from) throw new ValidationError('to: the last day can’t be before the first');
    const days = input.days ?? (input.kind === 'taken' ? workingDays(input.from, input.to) : null);
    if (days === null || days === 0) throw new ValidationError('days: say how many days');
    if (input.kind === 'taken' && days < 0) throw new ValidationError('days: leave taken is a number of days off');
    await this.db.transaction().execute(async (trx) => {
      const employee = await trx.selectFrom('employees').select(['name']).where('id', '=', employeeId).executeTakeFirst();
      if (!employee) throw new NotFoundError(`Employee ${employeeId} does not exist`);
      const row = await trx
        .insertInto('leave_entries')
        .values({ employee_id: employeeId, kind: input.kind, from_day: input.from, to_day: input.to, days, note: input.note, created_by: actorId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'leave.recorded',
        entityType: 'employee',
        entityId: employeeId,
        say: { key: 'leaveRecorded', params: { name: employee.name, days, taken: input.kind === 'taken' } },
        details: { leaveId: row.id },
      });
    });
    return this.get(employeeId, now);
  }

  async removeLeave(leaveId: number, actorId: number, now = new Date()): Promise<EmployeeDetailDto> {
    const employeeId = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('leave_entries as l')
        .innerJoin('employees as e', 'e.id', 'l.employee_id')
        .select(['l.employee_id', 'e.name'])
        .where('l.id', '=', leaveId)
        .executeTakeFirst();
      if (!row) throw new NotFoundError(`Leave record ${leaveId} does not exist`);
      await trx.deleteFrom('leave_entries').where('id', '=', leaveId).execute();
      await new ActivityLogRepository(trx).create({ userId: actorId, action: 'leave.removed', entityType: 'employee', entityId: row.employee_id, say: { key: 'leaveRemoved', params: { name: row.name } } });
      return row.employee_id;
    });
    return this.get(employeeId, now);
  }

  // ---------- A month ----------

  private rules(month: string): PayrollRules {
    const rules = rulesFor(month);
    if (!rules) throw new ValidationError('month: 4VD knows the wage rules from September 2024');
    return rules;
  }

  /** Who is paid in a month: started by its last day and not gone before its first. */
  private async workedIn(month: string) {
    const first = monthStart(month);
    const last = monthEnd(first);
    return (await employeeQuery(this.db)).filter((row) => row.started_on <= last && (row.left_on === null || row.left_on >= first));
  }

  /** A month worked out from the contracts, with any changed gross; nothing is saved. */
  async preview(month: string, changes: LineChange[], now = new Date()): Promise<PreviewDto> {
    const first = monthStart(month);
    const rules = this.rules(first);
    const confirmed = await this.liveMonth(first);
    if (confirmed) {
      const detail = await this.month(confirmed, now);
      return { month: first, dueOn: detail.dueOn, lines: detail.lines, totals: detail.totals, confirmedId: confirmed };
    }
    const rows = await this.workedIn(first);
    for (const change of changes) {
      if (!rows.some((row) => row.id === change.employeeId)) throw new ValidationError('changes: that person isn’t paid this month');
      if (change.reason.trim().length < 3) throw new ValidationError('changes: say why the gross is different this month');
    }
    const entries = await this.leaveEntries(rows.map((row) => row.id));
    const lines = rows.map((row) => {
      const input = toInput(row);
      const change = changes.find((one) => one.employeeId === row.id);
      const base = contractGross(input, rules);
      const gross = change ? roundMoney(change.gross) : base;
      const result = payFromGross(payInput(input, gross), rules);
      return this.line(row.id, input, result, base, change?.reason.trim() ?? null, first, rules, entries.get(row.id) ?? []);
    });
    lines.sort((a, b) => a.place.localeCompare(b.place) || a.name.localeCompare(b.name));
    return { month: first, dueOn: dueDayOf(first, rules), lines, totals: totalsOf(lines), confirmedId: null };
  }

  private line(employeeId: number, input: EmployeeInput, result: PayResult, contract: number, reason: string | null, month: string, rules: PayrollRules, entries: LeaveEntryDto[]): PreviewLine {
    const last = monthEnd(month);
    const warnings: LineWarning[] = [];
    // A full-time main job below the minimum wage; a part month or part-time is the owner's call.
    const partMonth = input.startedOn > month || (input.leftOn !== null && input.leftOn < last);
    if (!input.secondary && input.contract !== 'part_time' && !partMonth && result.gross < rules.minimumWage) warnings.push({ key: 'belowMinimum', minimum: rules.minimumWage });
    if (partMonth) warnings.push({ key: 'partMonth', startedOn: input.startedOn > month ? input.startedOn : null, leftOn: input.leftOn !== null && input.leftOn < last ? input.leftOn : null });
    if (input.leftOn !== null && input.leftOn <= last) {
      const owed = leaveBalance({ leaveDays: input.leaveDays, startedOn: input.startedOn, leftOn: input.leftOn }, entries, input.leftOn).balance;
      if (owed > 0) warnings.push({ key: 'leaveOwed', days: owed });
    }
    if (!input.personalNumber) warnings.push({ key: 'noPersonalNumber' });
    return {
      ...result,
      employeeId,
      name: input.name,
      personalNumber: input.personalNumber,
      place: input.place,
      secondary: input.secondary,
      nonResident: input.nonResident,
      contractGross: contract,
      payBasis: input.payBasis,
      changedReason: reason,
      warnings,
    };
  }

  private async liveMonth(month: string): Promise<number | null> {
    const row = await this.db.selectFrom('payroll_months').select('id').where('month', '=', month).where('voided_at', 'is', null).executeTakeFirst();
    return row?.id ?? null;
  }

  /** Save the month as previewed and post it. A month can be confirmed once it has started. */
  async confirm(month: string, changes: LineChange[], actorId: number, now = new Date()): Promise<MonthDetailDto> {
    const first = monthStart(month);
    if (first > monthStart(this.today(now))) throw new ValidationError('month: a month can be run once it has started');
    const preview = await this.preview(first, changes, now);
    if (preview.confirmedId) throw new ConflictError('This month’s payroll is already confirmed');
    if (preview.lines.length === 0) throw new ValidationError('month: nobody is on the payroll this month');
    const id = await this.db.transaction().execute(async (trx) => {
      await assertMonthsOpen(new VatMonthRepository(trx), [monthEnd(first)]);
      if (await trx.selectFrom('payroll_months').select('id').where('month', '=', first).where('voided_at', 'is', null).forUpdate().executeTakeFirst())
        throw new ConflictError('This month’s payroll is already confirmed');
      const row = await trx.insertInto('payroll_months').values({ month: first, confirmed_by: actorId }).returning('id').executeTakeFirstOrThrow();
      await trx
        .insertInto('payroll_lines')
        .values(
          preview.lines.map((line) => ({
            month_id: row.id,
            employee_id: line.employeeId,
            place: line.place,
            secondary: line.secondary,
            non_resident: line.nonResident,
            gross: line.gross,
            employee_rate: line.employeeRate,
            employer_rate: line.employerRate,
            employee_pension: line.employeePension,
            employer_pension: line.employerPension,
            taxable: line.taxable,
            tax: line.tax,
            net: line.net,
            changed_reason: line.changedReason,
          })),
        )
        .execute();
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'payroll.confirmed',
        entityType: 'payroll_month',
        entityId: row.id,
        say: { key: 'payrollConfirmed', params: { month: first.slice(0, 7), people: preview.lines.length, gross: preview.totals.gross } },
      });
      return row.id;
    });
    await this.syncBooks();
    return this.month(id, now);
  }

  /** Take a confirmed month back (its entry is reversed), while nothing of it is paid. */
  async undo(id: number, actorId: number, now = new Date()): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('payroll_months').select([sql<string>`to_char(month, 'YYYY-MM-DD')`.as('month'), 'voided_at']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row || row.voided_at) throw new NotFoundError(`Payroll month ${id} does not exist`);
      const paid = await trx.selectFrom('payroll_payments').select('id').where('month_id', '=', id).where('voided_at', 'is', null).executeTakeFirst();
      if (paid) throw new ConflictError('Take back its payments first: some of this month is paid');
      await assertMonthsOpen(new VatMonthRepository(trx), [monthEnd(row.month)]);
      await trx.updateTable('payroll_months').set({ voided_at: now, voided_by: actorId }).where('id', '=', id).execute();
      await new ActivityLogRepository(trx).create({ userId: actorId, action: 'payroll.voided', entityType: 'payroll_month', entityId: id, say: { key: 'payrollUndone', params: { month: row.month.slice(0, 7) } } });
    });
    await this.syncBooks();
  }

  async months(now = new Date()): Promise<MonthDto[]> {
    const ids = await this.db.selectFrom('payroll_months').select('id').where('voided_at', 'is', null).orderBy('month', 'desc').execute();
    const out: MonthDto[] = [];
    for (const { id } of ids) {
      const { lines: _lines, payments: _payments, unpaid: _unpaid, ...summary } = await this.month(id, now);
      out.push(summary);
    }
    return out;
  }

  async month(id: number, _now = new Date()): Promise<MonthDetailDto> {
    const row = await this.db
      .selectFrom('payroll_months as m')
      .leftJoin('users as u', 'u.id', 'm.confirmed_by')
      .select(['m.id', sql<string>`to_char(m.month, 'YYYY-MM-DD')`.as('month'), 'm.confirmed_at', 'm.voided_at', 'u.name as confirmed_by'])
      .where('m.id', '=', id)
      .executeTakeFirst();
    if (!row || row.voided_at) throw new NotFoundError(`Payroll month ${id} does not exist`);
    const rules = this.rules(row.month);
    const stored = await this.db
      .selectFrom('payroll_lines as l')
      .innerJoin('employees as e', 'e.id', 'l.employee_id')
      .select(['l.employee_id', 'e.name', 'e.personal_number', 'e.pay_basis', 'l.place', 'l.secondary', 'l.non_resident', 'l.gross', 'l.employee_rate', 'l.employer_rate', 'l.employee_pension', 'l.employer_pension', 'l.taxable', 'l.tax', 'l.net', 'l.changed_reason'])
      .where('l.month_id', '=', id)
      .execute();
    const lines: PreviewLine[] = stored
      .map((line) => {
        const gross = Number(line.gross);
        const employerPension = Number(line.employer_pension);
        const taxable = Number(line.taxable);
        return {
          employeeId: line.employee_id,
          name: line.name,
          personalNumber: line.personal_number,
          place: line.place,
          secondary: line.secondary,
          nonResident: line.non_resident,
          gross,
          employeeRate: Number(line.employee_rate),
          employerRate: Number(line.employer_rate),
          employeePension: Number(line.employee_pension),
          employerPension,
          taxable,
          taxParts: taxPartsOf(taxable, line.secondary, rules),
          tax: Number(line.tax),
          net: Number(line.net),
          cost: roundMoney(gross + employerPension),
          contractGross: gross,
          payBasis: line.pay_basis,
          changedReason: line.changed_reason,
          warnings: [],
        };
      })
      .sort((a, b) => a.place.localeCompare(b.place) || a.name.localeCompare(b.name));
    const payments = await this.payments(id);
    const totals = totalsOf(lines);
    const paidTo = new Map<number, number>();
    for (const payment of payments) for (const employeeId of payment.employeeIds) paidTo.set(employeeId, 0);
    const paidLines = await this.db
      .selectFrom('payroll_payment_lines as pl')
      .innerJoin('payroll_payments as p', 'p.id', 'pl.payment_id')
      .select(['pl.employee_id', 'pl.amount'])
      .where('p.month_id', '=', id)
      .where('p.voided_at', 'is', null)
      .execute();
    for (const paid of paidLines) paidTo.set(paid.employee_id, roundMoney((paidTo.get(paid.employee_id) ?? 0) + Number(paid.amount)));
    const unpaid = lines.map((line) => ({ employeeId: line.employeeId, amount: roundMoney(line.net - (paidTo.get(line.employeeId) ?? 0)) })).filter((left) => left.amount > 0);
    const paidKind = (kind: PaymentDto['kind']) => sumOf(payments.filter((payment) => payment.kind === kind), (payment) => payment.amount);
    return {
      id: row.id,
      month: row.month,
      dueOn: dueDayOf(row.month, rules),
      confirmedAt: row.confirmed_at.toISOString(),
      confirmedBy: row.confirmed_by,
      totals,
      wagesLeft: sumOf(unpaid, (left) => left.amount),
      taxLeft: roundMoney(totals.tax - paidKind('tax')),
      pensionLeft: roundMoney(totals.employeePension + totals.employerPension - paidKind('pension')),
      lines,
      payments,
      unpaid,
    };
  }

  private async payments(monthId: number): Promise<PaymentDto[]> {
    const rows = await this.db
      .selectFrom('payroll_payments as p')
      .innerJoin('money_places as mp', 'mp.id', 'p.place_id')
      .select(['p.id', 'p.kind', 'p.place_id', 'mp.name', 'mp.kind as place_kind', sql<string>`to_char(p.paid_on, 'YYYY-MM-DD')`.as('paid_on'), 'p.amount', 'p.carwash_amount', 'p.note'])
      .where('p.month_id', '=', monthId)
      .where('p.voided_at', 'is', null)
      .orderBy('p.paid_on')
      .orderBy('p.id')
      .execute();
    const people = rows.length === 0 ? [] : await this.db.selectFrom('payroll_payment_lines').select(['payment_id', 'employee_id']).where('payment_id', 'in', rows.map((row) => row.id)).execute();
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      placeId: row.place_id,
      placeName: row.name,
      placeKind: row.place_kind,
      paidOn: row.paid_on,
      amount: Number(row.amount),
      carwashAmount: Number(row.carwash_amount),
      employeeIds: people.filter((person) => person.payment_id === row.id).map((person) => person.employee_id),
      note: row.note,
    }));
  }

  /** For To do: last month, once over, if nobody has run it; and months with tax or pension still owed. */
  async reminders(now = new Date()): Promise<{ toRun: string[]; owed: Array<{ month: string; amount: number; dueOn: string }> }> {
    const today = this.today(now);
    const thisMonth = monthStart(today);
    const [year, mon] = thisMonth.split('-').map(Number) as [number, number];
    const last = mon === 1 ? `${year - 1}-12-01` : `${year}-${String(mon - 1).padStart(2, '0')}-01`;
    const toRun: string[] = [];
    if (rulesFor(last) && !(await this.liveMonth(last)) && (await this.workedIn(last)).length > 0) toRun.push(last);
    const owed: Array<{ month: string; amount: number; dueOn: string }> = [];
    for (const month of await this.months(now)) {
      const amount = roundMoney(month.taxLeft + month.pensionLeft);
      if (amount > 0) owed.push({ month: month.month, amount, dueOn: month.dueOn });
    }
    return { toRun, owed };
  }

  // ---------- Paying ----------

  private async checkPlace(db: DatabaseClient, placeId: number): Promise<void> {
    const place = await db.selectFrom('money_places').select(['id', 'archived_at']).where('id', '=', placeId).executeTakeFirst();
    if (!place || place.archived_at) throw new ValidationError('placeId: pick where the money comes from');
  }

  /** Net pay to some or all who are still owed it, in one payment from one place. */
  async payWages(monthId: number, input: { placeId: number; paidOn: string; employeeIds: number[] | null; note: string | null }, actorId: number, now = new Date()): Promise<MonthDetailDto> {
    const detail = await this.month(monthId, now);
    const chosen = detail.unpaid.filter((left) => input.employeeIds === null || input.employeeIds.includes(left.employeeId));
    if (chosen.length === 0) throw new ValidationError('employeeIds: nobody picked is still owed pay this month');
    const carwash = sumOf(
      chosen.filter((left) => detail.lines.find((line) => line.employeeId === left.employeeId)?.place === 'carwash'),
      (left) => left.amount,
    );
    const amount = sumOf(chosen, (left) => left.amount);
    await this.addPayments(monthId, detail.month, input, [{ kind: 'wages', amount, carwash, people: chosen }], actorId);
    return this.month(monthId, now);
  }

  /**
   * What is owed to ATK for the month: the wage tax and the pension as two
   * payments, because banks often send them as two transfers and each should
   * match its own statement line.
   */
  async payAtk(monthId: number, input: { placeId: number; paidOn: string; note: string | null }, actorId: number, now = new Date()): Promise<MonthDetailDto> {
    const detail = await this.month(monthId, now);
    const carwashLines = detail.lines.filter((line) => line.place === 'carwash');
    const carwashTax = sumOf(carwashLines, (line) => line.tax);
    const carwashPension = sumOf(carwashLines, (line) => line.employeePension + line.employerPension);
    const paidCarwash = (kind: 'tax' | 'pension') => sumOf(detail.payments.filter((payment) => payment.kind === kind), (payment) => payment.carwashAmount);
    const parts: Array<{ kind: 'tax' | 'pension'; amount: number; carwash: number; people: [] }> = [];
    if (detail.taxLeft > 0) parts.push({ kind: 'tax', amount: detail.taxLeft, carwash: Math.min(detail.taxLeft, roundMoney(carwashTax - paidCarwash('tax'))), people: [] });
    if (detail.pensionLeft > 0) parts.push({ kind: 'pension', amount: detail.pensionLeft, carwash: Math.min(detail.pensionLeft, roundMoney(carwashPension - paidCarwash('pension'))), people: [] });
    if (parts.length === 0) throw new ValidationError('Nothing is owed to ATK for this month');
    await this.addPayments(monthId, detail.month, input, parts, actorId);
    return this.month(monthId, now);
  }

  private async addPayments(
    monthId: number,
    month: string,
    input: { placeId: number; paidOn: string; note: string | null },
    parts: Array<{ kind: 'wages' | 'tax' | 'pension'; amount: number; carwash: number; people: Array<{ employeeId: number; amount: number }> }>,
    actorId: number,
  ): Promise<void> {
    if (input.paidOn < month) throw new ValidationError('paidOn: pay is paid after the month starts');
    await this.db.transaction().execute(async (trx) => {
      await this.checkPlace(trx, input.placeId);
      await assertMonthsOpen(new VatMonthRepository(trx), [input.paidOn]);
      await trx.selectFrom('payroll_months').select('id').where('id', '=', monthId).forUpdate().execute();
      for (const part of parts) {
        const row = await trx
          .insertInto('payroll_payments')
          .values({ month_id: monthId, kind: part.kind, place_id: input.placeId, paid_on: input.paidOn, amount: part.amount, carwash_amount: Math.max(0, part.carwash), note: input.note, created_by: actorId })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (part.people.length > 0) await trx.insertInto('payroll_payment_lines').values(part.people.map((person) => ({ payment_id: row.id, employee_id: person.employeeId, amount: person.amount }))).execute();
        await new ActivityLogRepository(trx).create({
          userId: actorId,
          action: 'payroll.paid',
          entityType: 'payroll_month',
          entityId: monthId,
          say: { key: 'payrollPaid', params: { month: month.slice(0, 7), kind: part.kind, amount: part.amount } },
          details: { paymentId: row.id },
        });
      }
    });
    await this.syncBooks();
  }

  async undoPayment(paymentId: number, actorId: number, now = new Date()): Promise<MonthDetailDto> {
    const monthId = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('payroll_payments as p')
        .innerJoin('payroll_months as m', 'm.id', 'p.month_id')
        .select(['p.month_id', 'p.amount', 'p.voided_at', sql<string>`to_char(p.paid_on, 'YYYY-MM-DD')`.as('paid_on'), sql<string>`to_char(m.month, 'YYYY-MM-DD')`.as('month')])
        .where('p.id', '=', paymentId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.voided_at) throw new NotFoundError(`Payment ${paymentId} does not exist`);
      const line = await trx.selectFrom('bank_lines').select('id').where('done_kind', '=', 'payroll').where('done_ref', '=', paymentId).where('status', '=', 'done').executeTakeFirst();
      if (line) throw new ConflictError('A bank statement line is matched to this payment: undo the match first');
      await assertMonthsOpen(new VatMonthRepository(trx), [row.paid_on]);
      await trx.updateTable('payroll_payments').set({ voided_at: now, voided_by: actorId }).where('id', '=', paymentId).execute();
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'payroll.payment_voided',
        entityType: 'payroll_month',
        entityId: row.month_id,
        say: { key: 'payrollPaymentUndone', params: { month: row.month.slice(0, 7), amount: Number(row.amount) } },
      });
      return row.month_id;
    });
    await this.syncBooks();
    return this.month(monthId, now);
  }

  // ---------- Payslips and the declaration ----------

  async business(): Promise<{ name: string; nui: string | null }> {
    const row = await this.db.selectFrom('businesses').select(['name', 'nui']).where('id', '=', sql<number>`current_business_id()`).executeTakeFirst();
    return { name: row?.name ?? '4VD', nui: row?.nui ?? null };
  }

  async payslip(monthId: number, employeeId: number, now = new Date()): Promise<PayslipData> {
    const detail = await this.month(monthId, now);
    const line = detail.lines.find((one) => one.employeeId === employeeId);
    if (!line) throw new NotFoundError('That person has no payslip this month');
    const employee = await this.get(employeeId, now);
    const entries = employee.leaveEntries.filter((entry) => entry.from <= monthEnd(detail.month));
    const wagePayments = detail.payments.filter((payment) => payment.kind === 'wages' && payment.employeeIds.includes(employeeId));
    return {
      business: await this.business(),
      month: detail.month,
      employee: { name: employee.name, personalNumber: employee.personalNumber, jobTitle: employee.jobTitle, bankAccount: employee.bankAccount, startedOn: employee.startedOn },
      line,
      leave: leaveBalance({ leaveDays: employee.leaveDays, startedOn: employee.startedOn, leftOn: employee.leftOn }, entries, monthEnd(detail.month)),
      paidOn: wagePayments.at(-1)?.paidOn ?? null,
    };
  }

  /** A person's own payslips and leave, for the Account page. */
  async mine(userId: number, now = new Date()): Promise<{ employeeId: number; leave: LeaveBalance; leaveEntries: LeaveEntryDto[]; payslips: PayslipRef[] } | null> {
    const id = await this.idForUser(userId);
    if (id === null) return null;
    const employee = await this.get(id, now);
    return { employeeId: id, leave: employee.leave, leaveEntries: employee.leaveEntries, payslips: employee.payslips };
  }

  /** Statement matching: wage and ATK payments from this place no line has found yet. */
  async unlinkedPayments(placeId: number, linked: Set<number>): Promise<Array<{ id: number; day: string; amount: number; kind: 'wages' | 'tax' | 'pension'; month: string }>> {
    const rows = await this.db
      .selectFrom('payroll_payments as p')
      .innerJoin('payroll_months as m', 'm.id', 'p.month_id')
      .select(['p.id', 'p.kind', 'p.amount', sql<string>`to_char(p.paid_on, 'YYYY-MM-DD')`.as('day'), sql<string>`to_char(m.month, 'YYYY-MM-DD')`.as('month')])
      .where('p.place_id', '=', placeId)
      .where('p.voided_at', 'is', null)
      .where('m.voided_at', 'is', null)
      .where(sql<boolean>`p.paid_on >= current_date - 180`)
      .execute();
    return rows.filter((row) => !linked.has(row.id)).map((row) => ({ id: row.id, day: row.day, amount: -Number(row.amount), kind: row.kind, month: row.month }));
  }
}

function toInput(row: EmployeeRow): EmployeeInput {
  return {
    userId: row.user_id,
    name: row.name,
    personalNumber: row.personal_number,
    jobTitle: row.job_title,
    contract: row.contract,
    startedOn: row.started_on,
    contractEndsOn: row.contract_ends_on,
    leftOn: row.left_on,
    payBasis: row.pay_basis,
    payAmount: Number(row.pay_amount),
    secondary: row.secondary,
    nonResident: row.non_resident,
    extraPensionEmployee: Number(row.extra_pension_employee),
    extraPensionEmployer: Number(row.extra_pension_employer),
    bankAccount: row.bank_account,
    bankName: row.bank_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    birthDate: row.birth_date,
    place: row.place,
    leaveDays: Number(row.leave_days),
    note: row.note,
  };
}

function toRow(input: EmployeeInput) {
  return {
    user_id: input.userId,
    name: input.name,
    personal_number: input.personalNumber,
    job_title: input.jobTitle,
    contract: input.contract,
    started_on: input.startedOn,
    contract_ends_on: input.contractEndsOn,
    left_on: input.leftOn,
    pay_basis: input.payBasis,
    pay_amount: input.payAmount,
    secondary: input.secondary,
    non_resident: input.nonResident,
    extra_pension_employee: input.extraPensionEmployee,
    extra_pension_employer: input.extraPensionEmployer,
    bank_account: input.bankAccount,
    bank_name: input.bankName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    birth_date: input.birthDate,
    place: input.place,
    leave_days: input.leaveDays,
    note: input.note,
  };
}

const payInput = (input: EmployeeInput, gross: number) => ({
  gross,
  secondary: input.secondary,
  nonResident: input.nonResident,
  extraEmployee: input.extraPensionEmployee,
  extraEmployer: input.extraPensionEmployer,
});

/** The month's gross from the contract: as agreed, or the agreed net worked back to gross. */
export function contractGross(input: EmployeeInput, rules: PayrollRules): number {
  if (input.payBasis === 'gross') return roundMoney(input.payAmount);
  const { gross: _gross, ...rest } = payInput(input, 0);
  return grossFromNet(input.payAmount, rest, rules);
}

/** A stored line's tax slices again, for the payslip and the screen. */
function taxPartsOf(taxable: number, secondary: boolean, rules: PayrollRules): TaxPart[] {
  return payFromGross({ gross: taxable, secondary, nonResident: true, extraEmployee: 0, extraEmployer: 0 }, rules).taxParts;
}
