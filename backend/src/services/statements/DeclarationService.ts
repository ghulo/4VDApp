import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import type { LegalForm, UserRole } from '../../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/httpErrors.js';
import { ActivityLogRepository } from '../../repositories/ActivityLogRepository.js';
import { roundMoney } from '../../utils/money.js';
import { zonedDay } from '../../utils/zonedDates.js';
import type { BooksPoster } from '../books/BooksPoster.js';
import type { StatementLine, StatementsService } from './StatementsService.js';
import { type DeclarationForm, formOf, incomeTax, type TaxPart, taxParts } from './taxRules.js';
import { type InstalmentDto, TAX_INPUTS_KEY, type YearService } from './YearService.js';

/**
 * The yearly income declaration to ATK: the CD for a company, the PD for an
 * individual business. Everything comes from the books and from what the
 * accountant types here; nothing new is posted except the rest of the tax,
 * paid with the declaration (through YearService.pay, quarter 0).
 *
 * DECLARATION_LAYOUT (a default, accountant to confirm, handoff.md): ATK's
 * own CD and PD forms and box numbers aren't known yet (TREFIN's were never
 * opened), so the figures follow 4VD's own layout: income, costs, book profit,
 * adjustments, losses carried forward, taxable profit, tax, instalments paid,
 * what is left. There is no ATK file: the figures are typed into EDI by hand.
 */
export const DECLARATION_DUE_MONTH_DAY = '03-31';

/**
 * DEFAULTS (accountant to confirm, handoff.md):
 * - representation (6020, 6910) is deductible up to 2% of the year's income;
 * - gifts and donations (6300, 6600) up to 10% of taxable profit before them;
 * - a loss is carried forward for up to 6 years, oldest first.
 */
export const REPRESENTATION_LIMIT = 0.02;
export const DONATIONS_LIMIT = 0.1;
export const LOSS_YEARS = 6;
const REPRESENTATION_ACCOUNTS = ['6020', '6910'];
const DONATION_ACCOUNTS = ['6300', '6600'];
const WAGE_ACCOUNTS = ['6500', '6510', '6520', '6530', '6540', '6550'];
const DEPRECIATION_ACCOUNTS = ['6040', '6150'];
const RENT_ACCOUNTS = ['6650'];
const FINANCIAL_INCOME_GROUP = 'Të hyrat financiare';
const FINANCIAL_COST_GROUP = 'Shpenzimet financiare';

export type IncomeKey = 'sales' | 'other_income' | 'financial_income' | 'carwash_takings';
export type CostKey = 'cost_of_goods' | 'wages' | 'depreciation' | 'rent' | 'running' | 'financial_costs' | 'other_costs' | 'carwash_costs';
export type AdjustmentKey = 'representation' | 'donations' | 'fines' | 'other';

export interface DeclarationAccount {
  accountId: number;
  number: string;
  name: string;
  amount: number;
}

export interface DeclarationLine<TKey extends string> {
  key: TKey;
  amount: number;
  /** The accounts behind it (none for the carwash, which is outside the books). */
  accounts: DeclarationAccount[];
}

export interface AdjustmentLine {
  key: AdjustmentKey;
  /** Typed lines ("other") carry their own words. */
  label: string | null;
  amount: number;
  /** What 4VD works out (representation, donations); null for typed lines. */
  suggested: number | null;
  /** What the books show as spent, and the part allowed, for the two worked-out lines. */
  spent: number | null;
  allowed: number | null;
  overridden: boolean;
}

export interface LossLine {
  year: number;
  /** The loss as first known: declared in 4VD, from a year closed in 4VD, or typed from TREFIN. */
  amount: number;
  source: 'declared' | 'closed' | 'typed';
  /** What later declarations already used. */
  usedBefore: number;
  /** What this declaration uses. */
  used: number;
}

export interface DeclarationInputs {
  /** The carwash's takings and costs, kept outside the books, count for the company's income. */
  includeCarwash: boolean;
  /** The accountant's own figure instead of 4VD's (null: 4VD's). */
  representation: number | null;
  donations: number | null;
  fines: number;
  other: Array<{ label: string; amount: number }>;
  /** Losses from years kept in TREFIN, as declared there. */
  earlierLosses: Array<{ year: number; amount: number }>;
}

export const EMPTY_INPUTS: DeclarationInputs = { includeCarwash: true, representation: null, donations: null, fines: 0, other: [], earlierLosses: [] };

export type DeclarationStatus = 'not_over' | 'to_file' | 'late' | 'filed';

export interface DeclarationFigures {
  year: number;
  form: DeclarationForm;
  legalForm: LegalForm;
  income: { lines: Array<DeclarationLine<IncomeKey>>; total: number };
  costs: { lines: Array<DeclarationLine<CostKey>>; total: number };
  /** Profit made before the books start, typed on Books → Year (no breakdown). */
  profitBeforeBooks: number;
  startsInYear: string | null;
  bookProfit: number;
  carwash: { included: boolean; takings: number; wages: number; bills: number };
  adjustments: AdjustmentLine[];
  adjustedProfit: number;
  losses: LossLine[];
  lossesUsed: number;
  taxable: number;
  taxParts: TaxPart[];
  tax: number;
}

export interface DeclarationDto extends DeclarationFigures {
  due: string;
  status: DeclarationStatus;
  inputs: DeclarationInputs;
  /** The TM paid for this year (quarters 1 to 4), whenever they were paid. */
  instalments: Array<InstalmentDto & { quarter: number }>;
  instalmentsTotal: number;
  /** The rest, paid with the declaration. */
  restPayment: InstalmentDto | null;
  /** Tax minus what was paid; below zero when too much was paid. */
  left: number;
  /** The tax posted when the year was closed in Books → Year, to compare. */
  closedTax: number | null;
  filed: { on: string; at: string; by: string | null } | null;
  /** The books moved after filing: the tax worked out today differs from the one filed. */
  changedSinceFiled: boolean;
  liveTax: number;
}

const sum = (values: number[]) => roundMoney(values.reduce((total, value) => total + value, 0));

function cleanInputs(raw: unknown): DeclarationInputs {
  const value = (raw ?? {}) as Partial<DeclarationInputs>;
  return {
    includeCarwash: value.includeCarwash !== false,
    representation: typeof value.representation === 'number' ? value.representation : null,
    donations: typeof value.donations === 'number' ? value.donations : null,
    fines: typeof value.fines === 'number' ? value.fines : 0,
    other: Array.isArray(value.other) ? value.other : [],
    earlierLosses: Array.isArray(value.earlierLosses) ? value.earlierLosses : [],
  };
}

export class DeclarationService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly poster: BooksPoster,
    private readonly statements: StatementsService,
    private readonly years: YearService,
    private readonly timeZone: string,
  ) {}

  private async row(year: number) {
    return this.db.selectFrom('tax_declarations as d').leftJoin('users as u', 'u.id', 'd.filed_by').select(['d.year', 'd.inputs', sql<string | null>`to_char(d.filed_on, 'YYYY-MM-DD')`.as('filed_on'), 'd.filed_at', 'd.filed', 'u.name as by_name']).where('d.year', '=', year).executeTakeFirst();
  }

  /** The carwash's takings, staff costs and bills for a year, from the day the books start. */
  private async carwash(year: number, startDay: string | null): Promise<DeclarationFigures['carwash']> {
    const from = startDay && startDay > `${year}-01-01` ? startDay : `${year}-01-01`;
    const to = `${year}-12-31`;
    const [takings, wages, bills] = await Promise.all([
      this.db.selectFrom('carwash_days').select(sql<string>`coalesce(sum(carwash_amount + change_amount), 0)`.as('total')).where('day', '>=', from).where('day', '<=', to).executeTakeFirst(),
      this.db
        .selectFrom('payroll_lines as l')
        .innerJoin('payroll_months as m', 'm.id', 'l.month_id')
        .select(sql<string>`coalesce(sum(l.gross + l.employer_pension), 0)`.as('total'))
        .where('l.place', '=', 'carwash')
        .where('m.voided_at', 'is', null)
        .where('m.month', '>=', `${from.slice(0, 7)}-01`)
        .where('m.month', '<=', to)
        .executeTakeFirst(),
      this.db
        .selectFrom('supplier_bills')
        .select(sql<string>`coalesce(sum(case when kind = 'credit' then -amount else amount end), 0)`.as('total'))
        .where('place', '=', 'carwash')
        .where('voided_at', 'is', null)
        .where('brought_over', '=', false)
        .where('trefin_ref', 'is', null)
        .where('issued_on', '>=', from)
        .where('issued_on', '<=', to)
        .executeTakeFirst(),
    ]);
    return { included: true, takings: roundMoney(Number(takings?.total ?? 0)), wages: roundMoney(Number(wages?.total ?? 0)), bills: roundMoney(Number(bills?.total ?? 0)) };
  }

  /** Losses of the six years before, less what later declarations already used. */
  private async losses(year: number, typed: DeclarationInputs['earlierLosses']): Promise<Array<Omit<LossLine, 'used'>>> {
    const first = year - LOSS_YEARS;
    const [closed, declared] = await Promise.all([
      this.db.selectFrom('book_years').select(['year', 'profit']).where('year', '>=', first).where('year', '<', year).execute(),
      this.db.selectFrom('tax_declarations').select(['year', 'filed']).where('year', '>=', first).where('year', '<', year).where('filed_at', 'is not', null).execute(),
    ]);
    const filed = new Map(declared.map((row) => [row.year, row.filed as DeclarationFigures]));
    const out: Array<Omit<LossLine, 'used'>> = [];
    for (let lossYear = first; lossYear < year; lossYear++) {
      const declaration = filed.get(lossYear);
      const closedYear = closed.find((row) => row.year === lossYear);
      const typedYear = typed.find((row) => row.year === lossYear);
      let amount = 0;
      let source: LossLine['source'] = 'typed';
      if (declaration) {
        amount = declaration.adjustedProfit < 0 ? -declaration.adjustedProfit : 0;
        source = 'declared';
      } else if (closedYear) {
        amount = Number(closedYear.profit) < 0 ? -Number(closedYear.profit) : 0;
        source = 'closed';
      } else if (typedYear) {
        amount = typedYear.amount;
      }
      if (amount <= 0) continue;
      // What the filed declarations after the loss year already took from it.
      let usedBefore = 0;
      for (const [laterYear, figures] of filed) {
        if (laterYear > lossYear) usedBefore += figures.losses.find((line) => line.year === lossYear)?.used ?? 0;
      }
      out.push({ year: lossYear, amount: roundMoney(amount), source, usedBefore: roundMoney(Math.min(usedBefore, amount)) });
    }
    return out;
  }

  /** The figures for a year as the books and the typed inputs give them today. */
  async figures(year: number, inputs: DeclarationInputs): Promise<DeclarationFigures> {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [statement, form, legal, startDay, yearView] = await Promise.all([
      this.statements.incomeStatement({ from, to }),
      this.years.form(),
      this.db.selectFrom('businesses').select('legal_form').where('id', '=', sql<number>`current_business_id()`).executeTakeFirst(),
      this.poster.startDay(),
      this.db.selectFrom('settings').select('value').where('key', '=', `${TAX_INPUTS_KEY}${year}`).executeTakeFirst(),
    ]);
    const section = (key: string) => statement.sections.find((candidate) => candidate.key === key)?.groups ?? [];
    const toAccount = (line: StatementLine): DeclarationAccount | null =>
      line.accountId === null || line.number === null || line.amount === 0 ? null : { accountId: line.accountId, number: line.number, name: line.name, amount: line.amount };
    const pick = (groups: ReturnType<typeof section>, test: (line: StatementLine, group: string) => boolean): DeclarationAccount[] =>
      groups.flatMap((group) => group.lines.filter((line) => test(line, group.name)).map(toAccount).filter((account): account is DeclarationAccount => account !== null));
    const line = <TKey extends string>(key: TKey, accounts: DeclarationAccount[]): DeclarationLine<TKey> => ({ key, amount: sum(accounts.map((account) => account.amount)), accounts });

    const expenses = section('expenses');
    const has = (numbers: string[]) => (row: StatementLine) => row.number !== null && numbers.includes(row.number);
    const special = [...WAGE_ACCOUNTS, ...DEPRECIATION_ACCOUNTS, ...RENT_ACCOUNTS];
    const carwash = await this.carwash(year, startDay);
    // The carwash is part of the company (4VD SH.P.K.); an individual business files without it.
    carwash.included = form === 'CD' && inputs.includeCarwash;

    const incomeLines: Array<DeclarationLine<IncomeKey>> = [
      line('sales', pick(section('revenue'), () => true)),
      line('financial_income', pick(section('other_income'), (_row, group) => group === FINANCIAL_INCOME_GROUP)),
      line('other_income', pick(section('other_income'), (_row, group) => group !== FINANCIAL_INCOME_GROUP)),
    ];
    const costLines: Array<DeclarationLine<CostKey>> = [
      line('cost_of_goods', pick(section('cost_of_sales'), () => true)),
      line('wages', pick(expenses, has(WAGE_ACCOUNTS))),
      line('depreciation', pick(expenses, has(DEPRECIATION_ACCOUNTS))),
      line('rent', pick(expenses, has(RENT_ACCOUNTS))),
      line('running', pick(expenses, (row) => !has(special)(row))),
      line('financial_costs', pick(section('other_expenses'), (_row, group) => group === FINANCIAL_COST_GROUP)),
      line('other_costs', pick(section('other_expenses'), (_row, group) => group !== FINANCIAL_COST_GROUP)),
    ];
    if (carwash.included) {
      incomeLines.push({ key: 'carwash_takings', amount: carwash.takings, accounts: [] });
      costLines.push({ key: 'carwash_costs', amount: roundMoney(carwash.wages + carwash.bills), accounts: [] });
    }
    const incomeTotal = sum(incomeLines.map((row) => row.amount));
    const costTotal = sum(costLines.map((row) => row.amount));
    const typedYear = (yearView?.value ?? {}) as { profitBefore?: number | null };
    const profitBeforeBooks = typeof typedYear.profitBefore === 'number' ? typedYear.profitBefore : 0;
    const bookProfit = roundMoney(incomeTotal - costTotal + profitBeforeBooks);

    // Book profit → taxable profit.
    const spentOn = (numbers: string[]) => sum(expenses.flatMap((group) => group.lines.filter(has(numbers)).map((row) => row.amount)));
    const representationSpent = spentOn(REPRESENTATION_ACCOUNTS);
    const representationAllowed = roundMoney(Math.max(0, incomeTotal * REPRESENTATION_LIMIT));
    const representationSuggested = roundMoney(Math.max(0, representationSpent - representationAllowed));
    const representation = inputs.representation ?? representationSuggested;
    const fines = roundMoney(inputs.fines);
    const other = inputs.other.map((row) => ({ label: row.label, amount: roundMoney(row.amount) }));
    const otherTotal = sum(other.map((row) => row.amount));
    const donationsSpent = spentOn(DONATION_ACCOUNTS);
    const beforeDonations = roundMoney(bookProfit + representation + fines + otherTotal + donationsSpent);
    const donationsAllowed = roundMoney(Math.max(0, beforeDonations * DONATIONS_LIMIT));
    const donationsSuggested = roundMoney(Math.max(0, donationsSpent - donationsAllowed));
    const donations = inputs.donations ?? donationsSuggested;
    const adjustments: AdjustmentLine[] = [
      { key: 'representation', label: null, amount: representation, suggested: representationSuggested, spent: representationSpent, allowed: representationAllowed, overridden: inputs.representation !== null },
      { key: 'donations', label: null, amount: donations, suggested: donationsSuggested, spent: donationsSpent, allowed: donationsAllowed, overridden: inputs.donations !== null },
      { key: 'fines', label: null, amount: fines, suggested: null, spent: null, allowed: null, overridden: false },
      ...other.map((row): AdjustmentLine => ({ key: 'other', label: row.label, amount: row.amount, suggested: null, spent: null, allowed: null, overridden: false })),
    ];
    const adjustedProfit = roundMoney(bookProfit + sum(adjustments.map((row) => row.amount)));

    // Losses carried forward, oldest first, only against a profit.
    let room = Math.max(0, adjustedProfit);
    const losses: LossLine[] = (await this.losses(year, inputs.earlierLosses)).map((loss) => {
      const used = roundMoney(Math.min(room, Math.max(0, loss.amount - loss.usedBefore)));
      room = roundMoney(room - used);
      return { ...loss, used };
    });
    const lossesUsed = sum(losses.map((loss) => loss.used));
    const taxable = roundMoney(Math.max(0, adjustedProfit - lossesUsed));
    return {
      year,
      form,
      legalForm: legal?.legal_form ?? 'company',
      income: { lines: incomeLines, total: incomeTotal },
      costs: { lines: costLines, total: costTotal },
      profitBeforeBooks,
      startsInYear: startDay && startDay > from && startDay <= to ? startDay : null,
      bookProfit,
      carwash,
      adjustments,
      adjustedProfit,
      losses,
      lossesUsed,
      taxable,
      taxParts: taxParts(form, taxable, year),
      tax: incomeTax(form, taxable, year),
    };
  }

  async declaration(year: number, now = new Date()): Promise<DeclarationDto> {
    const today = zonedDay(now, this.timeZone);
    const [row, instalments, closed] = await Promise.all([
      this.row(year),
      this.years.instalments(year),
      this.db.selectFrom('book_years').select('tax').where('year', '=', year).executeTakeFirst(),
    ]);
    const inputs = cleanInputs(row?.inputs);
    const live = await this.figures(year, inputs);
    const filedFigures = row?.filed_at ? (row.filed as DeclarationFigures) : null;
    const figures = filedFigures ?? live;
    const quarters = instalments.filter((item) => item.quarter >= 1);
    const rest = instalments.find((item) => item.quarter === 0) ?? null;
    const instalmentsTotal = sum(quarters.map((item) => item.amount));
    const due = `${year + 1}-${DECLARATION_DUE_MONTH_DAY}`;
    const status: DeclarationStatus = filedFigures ? 'filed' : today <= `${year}-12-31` ? 'not_over' : today > due ? 'late' : 'to_file';
    return {
      ...figures,
      due,
      status,
      inputs,
      instalments: quarters,
      instalmentsTotal,
      restPayment: rest,
      left: roundMoney(figures.tax - instalmentsTotal - (rest?.amount ?? 0)),
      closedTax: closed ? Number(closed.tax) : null,
      filed: row?.filed_at && row.filed_on ? { on: row.filed_on, at: row.filed_at.toISOString(), by: row.by_name } : null,
      changedSinceFiled: filedFigures !== null && filedFigures.tax !== live.tax,
      liveTax: live.tax,
    };
  }

  /** Save what the accountant typed (refused once the declaration is marked as filed). */
  async setInputs(year: number, input: DeclarationInputs, actor: { id: number; role: UserRole }, now = new Date()): Promise<DeclarationDto> {
    const row = await this.row(year);
    if (row?.filed_at) throw new ConflictError(`The ${year} declaration is marked as filed. Reopen it to change what was typed.`);
    if (input.representation !== null && input.representation < 0) throw new ValidationError("Representation added back can't be below zero.");
    if (input.donations !== null && input.donations < 0) throw new ValidationError("Donations added back can't be below zero.");
    if (input.fines < 0) throw new ValidationError("Fines can't be below zero.");
    for (const loss of input.earlierLosses) {
      if (loss.year >= year || loss.year < year - LOSS_YEARS) throw new ValidationError(`A loss is carried for ${LOSS_YEARS} years: pick a year from ${year - LOSS_YEARS} to ${year - 1}.`);
    }
    if (new Set(input.earlierLosses.map((loss) => loss.year)).size !== input.earlierLosses.length) throw new ValidationError('Type each year’s loss once.');
    const value = JSON.stringify({
      includeCarwash: input.includeCarwash,
      representation: input.representation === null ? null : roundMoney(input.representation),
      donations: input.donations === null ? null : roundMoney(input.donations),
      fines: roundMoney(input.fines),
      other: input.other.map((item) => ({ label: item.label.trim(), amount: roundMoney(item.amount) })),
      earlierLosses: input.earlierLosses.map((loss) => ({ year: loss.year, amount: roundMoney(loss.amount) })).sort((a, b) => a.year - b.year),
    } satisfies DeclarationInputs);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('tax_declarations')
        .values({ year, inputs: value, updated_by: actor.id, updated_at: new Date() })
        .onConflict((conflict) => conflict.columns(['business_id', 'year']).doUpdateSet({ inputs: value, updated_by: actor.id, updated_at: new Date() }))
        .execute();
      await new ActivityLogRepository(trx).create({ userId: actor.id, action: 'books.declaration_inputs_changed', entityType: null, entityId: null, say: { key: 'declarationInputsChanged', params: { year } }, details: JSON.parse(value) });
    });
    return this.declaration(year, now);
  }

  /** Mark as filed with ATK on a day: what was typed is locked and the figures are kept as filed. */
  async file(year: number, day: string, actor: { id: number; role: UserRole }, now = new Date()): Promise<DeclarationDto> {
    const today = zonedDay(now, this.timeZone);
    if (today <= `${year}-12-31`) throw new ValidationError(`${year} isn't over yet. Its declaration is filed from 1 January ${year + 1}.`);
    if (day <= `${year}-12-31`) throw new ValidationError(`The ${year} declaration is filed in ${year + 1} or later.`);
    if (day > today) throw new ValidationError("The day filed can't be in the future.");
    await this.poster.sync();
    const row = await this.row(year);
    if (row?.filed_at) throw new ConflictError(`The ${year} declaration is already marked as filed.`);
    const figures = await this.figures(year, cleanInputs(row?.inputs));
    const filed = JSON.stringify(figures);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('tax_declarations')
        .values({ year, filed_on: day, filed_by: actor.id, filed_at: new Date(), filed, updated_by: actor.id, updated_at: new Date() })
        .onConflict((conflict) => conflict.columns(['business_id', 'year']).doUpdateSet({ filed_on: day, filed_by: actor.id, filed_at: new Date(), filed, updated_by: actor.id, updated_at: new Date() }))
        .execute();
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: 'books.declaration_filed',
        entityType: null,
        entityId: null,
        say: { key: 'declarationFiled', params: { year, form: figures.form, day } },
        details: { year, taxable: figures.taxable, tax: figures.tax },
      });
    });
    return this.declaration(year, now);
  }

  /** Reopen a filed declaration, with a reason kept in the history. */
  async reopen(year: number, reason: string, actor: { id: number; role: UserRole }, now = new Date()): Promise<DeclarationDto> {
    const why = reason.trim();
    if (why.length < 3) throw new ValidationError('Say why the declaration is being reopened, so the history keeps the reason.');
    const row = await this.row(year);
    if (!row?.filed_at) throw new NotFoundError(`The ${year} declaration isn't marked as filed.`);
    const form = (row.filed as DeclarationFigures).form;
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('tax_declarations').set({ filed_on: null, filed_by: null, filed_at: null, filed: null, updated_by: actor.id, updated_at: new Date() }).where('year', '=', year).execute();
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: 'books.declaration_reopened',
        entityType: null,
        entityId: null,
        say: { key: 'declarationReopened', params: { year, form, reason: why } },
        details: { year, reason: why },
      });
    });
    return this.declaration(year, now);
  }

  /** Pay the rest of the year's tax with the declaration, from a till, the safe or a bank account. */
  async payRest(year: number, input: { amount: number; day: string; placeId: number; note?: string | null }, actor: { id: number; role: UserRole }, now = new Date()): Promise<DeclarationDto> {
    await this.years.pay(year, 0, input, actor, now);
    return this.declaration(year, now);
  }

  /** Last year's declaration while it isn't filed, from 1 January (for To do). */
  async due(now = new Date()): Promise<{ year: number; form: DeclarationForm; due: string; late: boolean } | null> {
    const today = zonedDay(now, this.timeZone);
    const year = Number(today.slice(0, 4)) - 1;
    const start = await this.poster.startDay();
    if (!start || start > `${year}-12-31`) return null;
    const row = await this.db.selectFrom('tax_declarations').select('filed_at').where('year', '=', year).executeTakeFirst();
    if (row?.filed_at) return null;
    const due = `${year + 1}-${DECLARATION_DUE_MONTH_DAY}`;
    return { year, form: await this.years.form(), due, late: today > due };
  }
}
