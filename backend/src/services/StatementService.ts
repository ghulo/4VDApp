import { sql } from 'kysely';
import { EXPENSE_CATEGORIES } from '../constants/expenses.js';
import type { DatabaseClient } from '../database/connection.js';
import type { BankLineDoneKind, BankLineStatus, BankRuleAction } from '../database/types.js';
import { AiUnavailableError, ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { type BankLineRecord, type MoneyRepository, type PlaceRecord, placeWords, type RuleFields } from '../repositories/MoneyRepository.js';
import type { SupplierBillRepository } from '../repositories/SupplierBillRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { StatementReader } from './ai/statementReader.js';
import { addMove, type MoneyService, payBillsTogether } from './MoneyService.js';
import { type Candidates, type LineAction, type Suggestion, suggest } from './money/matching.js';
import {
  applyLayout,
  detectLayout,
  fingerprints,
  layoutFits,
  preview,
  readCsv,
  readXlsx,
  type StatementLayout,
  type StatementLine,
  withBalances,
} from './money/statementFile.js';
import { createBill, payBill, voidBill } from './SupplierBillService.js';
import { receivePayment, type TabService } from './TabService.js';
import { assertMonthsOpen } from './vat/periodLock.js';

export type { LineAction, Reason, Suggestion } from './money/matching.js';
export type { StatementLayout } from './money/statementFile.js';

export interface StatementDto {
  id: number;
  fileName: string;
  format: 'csv' | 'xlsx' | 'pdf';
  firstDay: string | null;
  lastDay: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** What 4VD says was in the account at the end of the statement's last day. */
  ourBalance: number | null;
  /** The statement's closing balance less 4VD's: what is still missing from 4VD (or extra). */
  difference: number | null;
  linesRead: number;
  linesSkipped: number;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface BankLineDto {
  id: number;
  statementId: number;
  day: string;
  text: string;
  amount: number;
  balance: number | null;
  status: BankLineStatus;
  done: { kind: BankLineDoneKind; ref: number; madeRecord: boolean; by: string | null; at: string | null; billId: number | null; customerId: number | null } | null;
  ruleId: number | null;
  /** For an open line: what it might be, the likeliest first. */
  suggestions: Suggestion[];
}

export interface BankRuleDto {
  id: number;
  placeId: number | null;
  contains: string;
  direction: 'in' | 'out';
  action: BankRuleAction;
  category: string | null;
  supplierId: number | null;
  supplierName: string | null;
  otherPlaceId: number | null;
}

export interface UploadInput {
  fileName: string;
  /** The file as base64. */
  data: string;
  /** Which column is which, when 4VD had to ask. */
  layout?: StatementLayout;
}

export type UploadResult =
  | { needsLayout: false; statement: StatementDto; added: number; skipped: number }
  /** 4VD couldn't tell which column is which: the first rows, and its best guess. */
  | { needsLayout: true; preview: string[][]; guess: StatementLayout | null };

const MAX_BYTES = 10 * 1024 * 1024;

const formatOf = (fileName: string): 'csv' | 'xlsx' | 'pdf' => {
  const name = fileName.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv';
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.xls')) throw new ValidationError('Old .xls files can’t be read. Save it as .xlsx or CSV, or download it from the bank in one of those.');
  throw new ValidationError('Upload the statement as Excel (.xlsx), CSV or PDF');
};

/**
 * A bank account's statements: read the bank's file, then suggest what each
 * line is (a bill paid, an invoice received, cash taken to the bank, a fee)
 * and record it with one click.
 */
export class StatementService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly moneyRepository: MoneyRepository,
    private readonly billRepository: SupplierBillRepository,
    private readonly moneyService: MoneyService,
    private readonly tabService: TabService,
    private readonly transactions: TransactionManager,
    private readonly reader: StatementReader | null,
    private readonly timeZone: string,
  ) {}

  private async bank(placeId: number): Promise<PlaceRecord> {
    const place = await this.moneyRepository.placeOrThrow(placeId);
    if (place.kind !== 'bank') throw new ValidationError('Statements are for bank accounts');
    return place;
  }

  async upload(placeId: number, input: UploadInput, actorId: number): Promise<UploadResult> {
    const place = await this.bank(placeId);
    if (place.archived_at) throw new ValidationError('This account is closed');
    const format = formatOf(input.fileName);
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length === 0) throw new ValidationError('The file is empty');
    if (bytes.length > MAX_BYTES) throw new ValidationError('The file is over 10 MB');

    let read: { lines: StatementLine[]; openingBalance: number | null; closingBalance: number | null };
    if (format === 'pdf') {
      if (!this.reader) throw new AiUnavailableError('Reading PDF statements is not set up. Download the statement as Excel or CSV instead.');
      read = withBalances(await this.reader.read(bytes));
    } else {
      let rows;
      try {
        rows = format === 'csv' ? readCsv(bytes) : await readXlsx(bytes);
      } catch {
        throw new ValidationError('The file couldn’t be opened. Is it really an Excel or CSV file?');
      }
      let layout: StatementLayout | null = null;
      if (input.layout) {
        layout = input.layout;
      } else {
        const saved = place.statement_layout as StatementLayout | null;
        layout = saved ? layoutFits(rows, saved) : null;
        if (!layout) {
          const detected = detectLayout(rows);
          if (!detected || !detected.sure) return { needsLayout: true, preview: preview(rows), guess: detected?.layout ?? null };
          layout = detected.layout;
        }
      }
      const applied = applyLayout(rows, layout);
      if (applied.lines.length === 0) {
        if (input.layout) throw new ValidationError('No lines could be read with those columns');
        return { needsLayout: true, preview: preview(rows), guess: layout };
      }
      read = applied;
      await this.moneyRepository.saveLayout(placeId, layout);
    }
    if (read.lines.length === 0) throw new ValidationError('No lines were found in the statement');

    const prints = fingerprints(read.lines);
    const statementId = await this.transactions.run(async (repos) => {
      const known = await repos.money.knownFingerprints(placeId, prints);
      const fresh = read.lines.map((line, index) => ({ ...line, fingerprint: prints[index]!, position: index })).filter((line) => !known.has(line.fingerprint));
      const days = read.lines.map((line) => line.day).sort();
      const id = await repos.money.addStatement({
        placeId,
        fileName: input.fileName.slice(0, 200),
        format,
        firstDay: days[0] ?? null,
        lastDay: days[days.length - 1] ?? null,
        openingBalance: read.openingBalance,
        closingBalance: read.closingBalance,
        linesRead: fresh.length,
        linesSkipped: read.lines.length - fresh.length,
        uploadedBy: actorId,
      });
      await repos.money.addLines(id, placeId, fresh);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bank.statement_uploaded',
        entityType: 'bank_statement',
        entityId: id,
        say: { key: 'statementUploaded', params: { place: placeWords(place), lines: fresh.length, skipped: read.lines.length - fresh.length } },
        details: { placeId, fileName: input.fileName, format },
      });
      return id;
    });
    const statement = (await this.statements(placeId)).find((candidate) => candidate.id === statementId)!;
    return { needsLayout: false, statement, added: statement.linesRead, skipped: statement.linesSkipped };
  }

  async statements(placeId: number): Promise<StatementDto[]> {
    await this.bank(placeId);
    const rows = await this.moneyRepository.statements(placeId);
    return Promise.all(
      rows.map(async (row) => {
        const ourBalance = row.last_day ? await this.moneyService.balanceOn(placeId, row.last_day) : null;
        const closing = row.closing_balance === null ? null : Number(row.closing_balance);
        return {
          id: row.id,
          fileName: row.file_name,
          format: row.format,
          firstDay: row.first_day,
          lastDay: row.last_day,
          openingBalance: row.opening_balance === null ? null : Number(row.opening_balance),
          closingBalance: closing,
          ourBalance,
          difference: closing === null || ourBalance === null ? null : roundMoney(closing - ourBalance),
          linesRead: row.lines_read,
          linesSkipped: row.lines_skipped,
          uploadedBy: row.uploaded_by_name,
          uploadedAt: row.uploaded_at.toISOString(),
        };
      }),
    );
  }

  /** What 4VD has that a line could be: open bills and invoices, and payments and moves of this account no line has found yet. */
  private async candidates(placeId: number): Promise<Candidates> {
    const [bills, items, linkedPayments, linkedGroups, linkedReceipts, linkedMoves, rules, shopTillId] = await Promise.all([
      this.billRepository.findMany({ status: 'open' }),
      this.tabService.allOpenItems(),
      this.moneyRepository.linkedRefs('payment'),
      this.moneyRepository.linkedRefs('payment_group'),
      this.moneyRepository.linkedRefs('tab_payment'),
      this.moneyRepository.linkedRefs('move'),
      this.moneyRepository.rules(),
      this.moneyRepository.shopTillId(),
    ]);
    const since = sql`current_date - 180`;
    const [payments, groups, receipts, moves] = await Promise.all([
      sql<{ id: number; day: string; amount: string; name: string | null; number: string | null }>`
        select p.id, to_char(p.paid_on, 'YYYY-MM-DD') as day, p.amount, s.name, b.number
        from supplier_payments p join supplier_bills b on b.id = p.bill_id left join suppliers s on s.id = b.supplier_id
        where p.place_id = ${placeId} and p.group_id is null and p.voided_at is null and p.paid_on >= ${since}
      `.execute(this.db),
      sql<{ id: number; day: string; amount: string; name: string | null }>`
        select g.id, to_char(g.paid_on, 'YYYY-MM-DD') as day, sum(p.amount) as amount, s.name
        from payment_groups g join supplier_payments p on p.group_id = g.id and p.voided_at is null left join suppliers s on s.id = g.supplier_id
        where g.place_id = ${placeId} and g.paid_on >= ${since}
        group by g.id, s.name
      `.execute(this.db),
      sql<{ id: number; day: string; amount: string; name: string }>`
        select e.id, to_char(e.occurred_at at time zone ${this.timeZone}, 'YYYY-MM-DD') as day, e.amount, c.name
        from tab_entries e join customers c on c.id = e.customer_id
        where e.kind = 'payment' and e.place_id = ${placeId} and e.occurred_at >= ${since}
      `.execute(this.db),
      sql<{ id: number; day: string; amount: string; from_place_id: number | null; to_place_id: number | null }>`
        select m.id, to_char(m.day, 'YYYY-MM-DD') as day, m.amount, m.from_place_id, m.to_place_id
        from money_moves m
        where m.voided_at is null and (m.from_place_id = ${placeId} or m.to_place_id = ${placeId}) and m.day >= ${since}
      `.execute(this.db),
    ]);
    return {
      bills: bills
        .filter((bill) => bill.supplier_id !== null && bill.kind === 'bill')
        .map((bill) => ({
          id: bill.id,
          supplierId: bill.supplier_id!,
          supplierName: bill.supplier_name ?? '',
          number: bill.number,
          issuedOn: bill.issued_on,
          left: roundMoney(Number(bill.amount) - Number(bill.paid)),
        }))
        .filter((bill) => bill.left > 0),
      items: items.filter((item) => item.left > 0).map((item) => ({ customerId: item.customerId, customerName: item.customerName, documentId: item.documentId, number: item.number, date: item.date, left: item.left })),
      payments: payments.rows.filter((row) => !linkedPayments.has(row.id)).map((row) => ({ id: row.id, day: row.day, amount: Number(row.amount), name: row.name, numbers: row.number ? [row.number] : [] })),
      groups: groups.rows.filter((row) => !linkedGroups.has(row.id)).map((row) => ({ id: row.id, day: row.day, amount: Number(row.amount), name: row.name })),
      receipts: receipts.rows.filter((row) => !linkedReceipts.has(row.id)).map((row) => ({ id: row.id, day: row.day, amount: Number(row.amount), name: row.name })),
      moves: moves.rows
        .filter((row) => !linkedMoves.has(row.id))
        .map((row) => {
          const out = row.from_place_id === placeId;
          return { id: row.id, day: row.day, amount: out ? -Number(row.amount) : Number(row.amount), name: null, otherPlaceId: out ? row.to_place_id : row.from_place_id };
        }),
      rules: rules
        .filter((rule) => rule.place_id === null || rule.place_id === placeId)
        .map((rule) => ({ id: rule.id, contains: rule.contains, direction: rule.direction, action: rule.action, category: rule.category, supplierId: rule.supplier_id, otherPlaceId: rule.other_place_id })),
      shopTillId,
    };
  }

  async lines(placeId: number, status: BankLineStatus | 'all'): Promise<BankLineDto[]> {
    await this.bank(placeId);
    const records = await this.moneyRepository.lines(placeId, status);
    const open = records.filter((line) => line.status === 'open');
    const candidates = open.length > 0 ? await this.candidates(placeId) : null;
    const links = await this.doneLinks(records.filter((line) => line.status === 'done'));
    return records.map((line) => ({
      id: line.id,
      statementId: line.statement_id,
      day: line.day,
      text: line.text,
      amount: Number(line.amount),
      balance: line.balance === null ? null : Number(line.balance),
      status: line.status,
      done:
        line.status === 'done'
          ? {
              kind: line.done_kind!,
              ref: line.done_ref!,
              madeRecord: line.made_record,
              by: line.done_by_name,
              at: line.done_at?.toISOString() ?? null,
              billId: links.bills.get(`${line.done_kind}:${line.done_ref}`) ?? null,
              customerId: links.customers.get(line.done_ref!) ?? null,
            }
          : null,
      ruleId: line.rule_id,
      suggestions: line.status === 'open' && candidates ? suggest({ day: line.day, text: line.text, amount: Number(line.amount) }, candidates) : [],
    }));
  }

  /** Where a done line's record can be opened: its bill, or its customer. */
  private async doneLinks(lines: BankLineRecord[]): Promise<{ bills: Map<string, number>; customers: Map<number, number> }> {
    const refs = (kind: BankLineDoneKind) => lines.filter((line) => line.done_kind === kind).map((line) => line.done_ref!);
    const bills = new Map<string, number>();
    const customers = new Map<number, number>();
    const payments = refs('payment');
    if (payments.length > 0) {
      for (const row of await this.db.selectFrom('supplier_payments').select(['id', 'bill_id']).where('id', 'in', payments).execute()) bills.set(`payment:${row.id}`, row.bill_id);
    }
    for (const id of refs('expense')) bills.set(`expense:${id}`, id);
    const groups = refs('payment_group');
    if (groups.length > 0) {
      for (const row of await this.db.selectFrom('supplier_payments').select(['group_id', sql<number>`min(bill_id)`.as('bill_id')]).where('group_id', 'in', groups).groupBy('group_id').execute()) {
        bills.set(`payment_group:${row.group_id}`, row.bill_id);
      }
    }
    const receipts = refs('tab_payment');
    if (receipts.length > 0) {
      for (const row of await this.db.selectFrom('tab_entries').select(['id', 'customer_id']).where('id', 'in', receipts).execute()) customers.set(row.id, row.customer_id);
    }
    return { bills, customers };
  }

  /** Record what a line is: find or make its payment, move or expense. Optionally save a rule for lines like it. */
  async confirm(lineId: number, action: LineAction, actorId: number, options: { rule?: { contains: string } | null; ruleId?: number | null } = {}, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      const line = await repos.money.lockLine(lineId);
      const place = await repos.money.placeOrThrow(line.place_id);
      let ruleId = options.ruleId ?? null;
      if (options.rule) ruleId = await saveRuleFrom(repos, line, action, options.rule.contains, actorId);
      await confirmLine(repos, line, action, actorId, ruleId, this.timeZone, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bank.line_confirmed',
        entityType: 'bank_statement',
        entityId: line.statement_id,
        say: { key: 'bankLineConfirmed', params: { place: placeWords(place), amount: Math.abs(Number(line.amount)), text: line.text.slice(0, 80) } },
        details: { lineId, action },
      });
    });
  }

  /** Confirm every open line of an account that has one sure suggestion. Each goes in on its own, so one that fails leaves the rest. */
  async confirmSure(placeId: number, actorId: number, now = new Date()): Promise<{ confirmed: number; failed: number }> {
    const place = await this.bank(placeId);
    const lines = await this.lines(placeId, 'open');
    let confirmed = 0;
    let failed = 0;
    for (const line of lines) {
      const sure = line.suggestions.find((suggestion) => suggestion.sure);
      if (!sure) continue;
      try {
        await this.transactions.run(async (repos) => {
          const record = await repos.money.lockLine(line.id);
          await confirmLine(repos, record, sure.action, actorId, sure.ruleId, this.timeZone, now);
        });
        confirmed += 1;
      } catch {
        // Something changed since (a bill paid, a month filed); the line stays open with its suggestions.
        failed += 1;
      }
    }
    if (confirmed > 0) {
      await this.transactions.run((repos) =>
        repos.activityLog.create({
          userId: actorId,
          action: 'bank.line_confirmed',
          entityType: 'money_place',
          entityId: placeId,
          say: { key: 'bankLineConfirmed', params: { place: placeWords(place), amount: 0, text: '', lines: confirmed } },
          details: { confirmed, failed },
        }),
      );
    }
    return { confirmed, failed };
  }

  /** Take a match back: a record the match made is removed (and reversed in the books); one it only found stays. */
  async undo(lineId: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      const line = await repos.money.lockLine(lineId);
      if (line.status !== 'done') throw new ConflictError('This line is not matched');
      const place = await repos.money.placeOrThrow(line.place_id);
      if (line.made_record) {
        await assertMonthsOpen(repos.periods, [line.day]);
        await removeRecord(repos, line.done_kind!, line.done_ref!, actorId, now);
      }
      await repos.money.markStatus(lineId, 'open', actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bank.line_undone',
        entityType: 'bank_statement',
        entityId: line.statement_id,
        say: { key: 'bankLineUndone', params: { place: placeWords(place), amount: Math.abs(Number(line.amount)), text: line.text.slice(0, 80) } },
        details: { lineId, kind: line.done_kind, ref: line.done_ref, removed: line.made_record },
      });
    });
  }

  /** A line that needs nothing in 4VD (already counted some other way): set aside, or brought back. */
  async skip(lineId: number, skipped: boolean, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      const line = await repos.money.lockLine(lineId);
      if (line.status === 'done') throw new ConflictError('Take the match back first');
      if ((line.status === 'skipped') === skipped) return;
      await repos.money.markStatus(lineId, skipped ? 'skipped' : 'open', actorId, now);
      if (!skipped) return;
      const place = await repos.money.placeOrThrow(line.place_id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bank.line_skipped',
        entityType: 'bank_statement',
        entityId: line.statement_id,
        say: { key: 'bankLineSkipped', params: { place: placeWords(place), amount: Math.abs(Number(line.amount)), text: line.text.slice(0, 80) } },
        details: { lineId },
      });
    });
  }

  async rules(): Promise<BankRuleDto[]> {
    return (await this.moneyRepository.rules()).map((rule) => ({
      id: rule.id,
      placeId: rule.place_id,
      contains: rule.contains,
      direction: rule.direction,
      action: rule.action,
      category: rule.category,
      supplierId: rule.supplier_id,
      supplierName: rule.supplier_name,
      otherPlaceId: rule.other_place_id,
    }));
  }

  async saveRule(id: number | null, fields: RuleFields, actorId: number): Promise<BankRuleDto> {
    checkRule(fields);
    const ruleId = await this.transactions.run(async (repos) => {
      if (fields.otherPlaceId !== null) await repos.money.placeOrThrow(fields.otherPlaceId);
      let saved = id;
      if (id === null) saved = await repos.money.addRule(fields, actorId);
      else {
        if (!(await repos.money.findRule(id))) throw new NotFoundError(`Rule ${id} does not exist`);
        await repos.money.updateRule(id, fields);
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'bank.rule_saved',
        entityType: 'bank_rule',
        entityId: saved!,
        say: { key: 'bankRuleSaved', params: { contains: fields.contains } },
        details: { ...fields },
      });
      return saved!;
    });
    return (await this.rules()).find((rule) => rule.id === ruleId)!;
  }

  async removeRule(id: number, actorId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      const rule = await repos.money.findRule(id);
      if (!rule) throw new NotFoundError(`Rule ${id} does not exist`);
      await repos.money.removeRule(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bank.rule_removed',
        entityType: 'bank_rule',
        entityId: id,
        say: { key: 'bankRuleRemoved', params: { contains: rule.contains } },
        details: {},
      });
    });
  }

  today(now = new Date()): string {
    return zonedDay(now, this.timeZone);
  }
}

function checkRule(fields: RuleFields): void {
  if (fields.action === 'expense') {
    if (fields.direction !== 'out') throw new ValidationError('An expense rule is for money going out');
    if (!fields.category || !(EXPENSE_CATEGORIES as readonly string[]).includes(fields.category)) throw new ValidationError('Pick what the expense is for');
  }
  if (fields.action === 'transfer' && fields.otherPlaceId === null) throw new ValidationError('Pick the other place');
  if (fields.otherPlaceId !== null && fields.otherPlaceId === fields.placeId) throw new ValidationError('The other place has to be a different one');
}

async function saveRuleFrom(repos: TransactionalRepositories, line: BankLineRecord, action: LineAction, contains: string, actorId: number): Promise<number> {
  const text = contains.trim();
  if (text.length < 3) throw new ValidationError('A rule needs at least 3 letters to look for');
  const direction = Number(line.amount) < 0 ? 'out' : 'in';
  let fields: RuleFields;
  if (action.kind === 'expense') fields = { placeId: line.place_id, contains: text, direction, action: 'expense', category: action.category, supplierId: action.supplierId, otherPlaceId: null };
  else if (action.kind === 'move')
    fields = { placeId: line.place_id, contains: text, direction, action: action.otherPlaceId === null ? 'owner' : 'transfer', category: null, supplierId: null, otherPlaceId: action.otherPlaceId };
  else throw new ValidationError('Rules are for expenses and moves');
  checkRule(fields);
  const id = await repos.money.addRule(fields, actorId);
  await repos.activityLog.create({
    userId: actorId,
    action: 'bank.rule_saved',
    entityType: 'bank_rule',
    entityId: id,
    say: { key: 'bankRuleSaved', params: { contains: text } },
    details: { ...fields },
  });
  return id;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Inside a transaction, with the line locked: make or find the record, then mark the line done. */
async function confirmLine(repos: TransactionalRepositories, line: BankLineRecord, action: LineAction, actorId: number, ruleId: number | null, timeZone: string, now: Date): Promise<void> {
  if (line.status !== 'open') throw new ConflictError(line.status === 'done' ? 'This line is already matched' : 'This line was left out; bring it back first');
  const amount = Math.abs(Number(line.amount));
  const moneyOut = Number(line.amount) < 0;
  const placeId = line.place_id;
  const today = zonedDay(now, timeZone);
  const day = line.day > today ? today : line.day;
  const note = line.text.slice(0, 200);
  let kind: BankLineDoneKind;
  let ref: number;
  let made = true;

  switch (action.kind) {
    case 'payBills': {
      if (!moneyOut) throw new ValidationError('Money coming in can’t pay a bill');
      const total = roundMoney(action.bills.reduce((sum, bill) => sum + bill.amount, 0));
      if (!close(total, amount)) throw new ValidationError('The bills don’t add up to the line');
      if (action.bills.length === 1) {
        kind = 'payment';
        ref = await payBill(repos, action.bills[0]!.billId, { amount, paidOn: day, placeId, note, supplierId: action.supplierId }, actorId);
      } else {
        kind = 'payment_group';
        ref = await payBillsTogether(repos, { supplierId: action.supplierId, placeId, paidOn: day, note, bills: action.bills }, actorId);
      }
      break;
    }
    case 'linkPayment':
    case 'linkGroup':
    case 'linkReceipt':
    case 'linkMove': {
      kind = action.kind === 'linkPayment' ? 'payment' : action.kind === 'linkGroup' ? 'payment_group' : action.kind === 'linkReceipt' ? 'tab_payment' : 'move';
      ref = action.kind === 'linkPayment' ? action.paymentId : action.kind === 'linkGroup' ? action.groupId : action.kind === 'linkReceipt' ? action.entryId : action.moveId;
      made = false;
      if (await repos.money.lineFor(kind, ref)) throw new ConflictError('Another statement line already has that');
      const found = kind === 'move' ? await repos.money.moveFor(ref, placeId) : await repos.money.recordFor(kind, ref);
      if (!found || found.placeId !== placeId) throw new ValidationError('That isn’t a record of this account');
      if (!close(Math.abs(found.amount), amount) || (found.amount < 0) !== moneyOut) throw new ValidationError('The amounts are different');
      break;
    }
    case 'receive': {
      if (moneyOut) throw new ValidationError('Money going out can’t be a customer’s payment');
      kind = 'tab_payment';
      ref = await receivePayment(repos, action.customerId, { amount, note, placeId, day, allocations: action.allocations.length > 0 ? action.allocations : undefined }, actorId, timeZone, now);
      break;
    }
    case 'move': {
      kind = 'move';
      ref = await addMove(repos, { day, amount, fromPlaceId: moneyOut ? placeId : action.otherPlaceId, toPlaceId: moneyOut ? action.otherPlaceId : placeId, note }, actorId, today);
      break;
    }
    case 'expense': {
      if (!moneyOut) throw new ValidationError('Money coming in can’t be an expense');
      if (!(EXPENSE_CATEGORIES as readonly string[]).includes(action.category)) throw new ValidationError('Pick what the expense is for');
      await assertMonthsOpen(repos.periods, [day]);
      kind = 'expense';
      ref = (await createBill(
        repos,
        {
          supplierId: action.supplierId,
          number: null,
          issuedOn: day,
          dueOn: null,
          note,
          lines: [{ kind: 'cost', category: action.category, amount, vatRate: 0 }],
          pricesIncludeVat: true,
          paidNow: { placeId },
          place: 'shop',
        },
        actorId,
        { today },
      ))!;
      break;
    }
  }
  await repos.money.markDone(line.id, { kind, ref, madeRecord: made, ruleId, by: actorId, at: now });
}

/** Remove the record a match made. */
async function removeRecord(repos: TransactionalRepositories, kind: BankLineDoneKind, ref: number, actorId: number, now: Date): Promise<void> {
  switch (kind) {
    case 'payment':
      await repos.bills.voidPayment(ref, actorId, now);
      return;
    case 'payment_group':
      await repos.money.voidGroup(ref, actorId, now);
      return;
    case 'tab_payment':
      await repos.tabs.removePayment(ref);
      return;
    case 'move':
      await repos.money.voidMove(ref, actorId, now);
      return;
    case 'expense':
      await voidBill(repos, ref, 'Taken back from the bank statement', actorId, now);
      return;
  }
}
