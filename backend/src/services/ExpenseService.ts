import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpensePlace } from '../constants/expenses.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { ExpenseRecord, ExpenseRepository, RecurringExpenseRecord } from '../repositories/ExpenseRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay, zonedDays } from '../utils/zonedDates.js';
import type { CarwashService } from './CarwashService.js';
import type { DateRange } from './reports/calculations.js';

/** A monthly rule's day is capped here so every month has it. */
export const LAST_REPEAT_DAY = 28;

export interface ExpenseDto {
  id: number;
  day: string;
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  /** Which carwash, for a carwash expense. */
  carwashId: number | null;
  carwashName: string | null;
  note: string | null;
  /** Set when a monthly rule added it. */
  recurringId: number | null;
  addedBy: string | null;
}

export interface ExpenseTotals {
  total: number;
  byPlace: Record<ExpensePlace, number>;
  /** The carwash part of `byPlace`, split by carwash. */
  byCarwash: Array<{ carwashId: number; name: string; total: number }>;
  byCategory: Record<ExpenseCategory, number>;
}

export interface RecurringExpenseDto {
  id: number;
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwashId: number | null;
  carwashName: string | null;
  note: string | null;
  dayOfMonth: number;
  addedBy: string | null;
}

export interface NewExpenseInput {
  day: string;
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  /** For a carwash expense; left out means the only open carwash. */
  carwashId?: number;
  note: string | null;
  repeatMonthly: boolean;
}

const toDto = (row: ExpenseRecord): ExpenseDto => ({
  id: row.id,
  day: row.day,
  amount: Number(row.amount),
  category: row.category,
  place: row.place,
  carwashId: row.carwash_id,
  carwashName: row.carwash_name,
  note: row.note,
  recurringId: row.recurring_id,
  addedBy: row.created_by_name,
});

const toRecurringDto = (row: RecurringExpenseRecord): RecurringExpenseDto => ({
  id: row.id,
  amount: Number(row.amount),
  category: row.category,
  place: row.place,
  carwashId: row.carwash_id,
  carwashName: row.carwash_name,
  note: row.note,
  dayOfMonth: row.day_of_month,
  addedBy: row.created_by_name,
});

/** The same day of the month after `day` ("2026-10-28" → "2026-11-28"). */
export function nextMonthDay(day: string, dayOfMonth: number): string {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(year, month, dayOfMonth));
  return next.toISOString().slice(0, 10);
}

/**
 * What the business spends, for the shop, the carwash or both, so reports
 * can show real profit. Rent and wages repeat by themselves every month.
 */
export class ExpenseService {
  constructor(
    private readonly expenseRepository: ExpenseRepository,
    private readonly transactions: TransactionManager,
    private readonly carwashService: CarwashService,
    private readonly timeZone: string,
  ) {}

  async list(range: DateRange): Promise<{ expenses: ExpenseDto[]; totals: ExpenseTotals }> {
    const { from, to } = zonedDays(range, this.timeZone);
    const expenses = (await this.expenseRepository.findBetween(from, to)).map(toDto);
    const byPlace: Record<ExpensePlace, number> = { shop: 0, carwash: 0, both: 0 };
    const byCarwash = new Map<number, { carwashId: number; name: string; total: number }>();
    const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((category) => [category, 0])) as Record<ExpenseCategory, number>;
    for (const expense of expenses) {
      byPlace[expense.place] = roundMoney(byPlace[expense.place] + expense.amount);
      if (expense.carwashId !== null) {
        const entry = byCarwash.get(expense.carwashId) ?? { carwashId: expense.carwashId, name: expense.carwashName!, total: 0 };
        entry.total = roundMoney(entry.total + expense.amount);
        byCarwash.set(expense.carwashId, entry);
      }
      byCategory[expense.category] = roundMoney(byCategory[expense.category] + expense.amount);
    }
    const total = roundMoney(expenses.reduce((sum, expense) => sum + expense.amount, 0));
    return { expenses, totals: { total, byPlace, byCarwash: [...byCarwash.values()], byCategory } };
  }

  /** What was spent on one shop day. */
  async onDay(day: string): Promise<ExpenseDto[]> {
    return (await this.expenseRepository.findBetween(day, day)).map(toDto);
  }

  async total(range: DateRange): Promise<number> {
    const { from, to } = zonedDays(range, this.timeZone);
    return roundMoney(await this.expenseRepository.total(from, to));
  }

  async recurring(): Promise<RecurringExpenseDto[]> {
    return (await this.expenseRepository.findActiveRecurring()).map(toRecurringDto);
  }

  async add(input: NewExpenseInput, actorId: number, now = new Date()): Promise<ExpenseDto> {
    const today = zonedDay(now, this.timeZone);
    if (input.day > today) throw new ValidationError("An expense can't be for a day that hasn't happened yet");
    const dayOfMonth = Math.min(Number(input.day.slice(8, 10)), LAST_REPEAT_DAY);
    const carwash = input.place === 'carwash' ? await this.carwashService.resolve(input.carwashId) : null;
    const carwashId = carwash?.id ?? null;
    const placeName = carwash ? `${carwash.name} carwash` : input.place;

    const id = await this.transactions.run(async (repos) => {
      const recurringId = input.repeatMonthly
        ? await repos.expenses.addRecurring({ ...input, carwashId, dayOfMonth, lastFilledOn: input.day, createdBy: actorId })
        : null;
      const expenseId = (await repos.expenses.add({ ...input, carwashId, recurringId, createdBy: actorId }))!;
      await repos.activityLog.create({
        userId: actorId,
        action: 'expense.added',
        entityType: 'expense',
        entityId: expenseId,
        summary: `Added an expense: ${formatEuro(input.amount)} for ${input.category} (${placeName}) on ${input.day}${input.repeatMonthly ? ', repeating every month' : ''}`,
        details: { ...input, carwashId },
      });
      return expenseId;
    });
    // A monthly rule started in the past fills in the months since.
    if (input.repeatMonthly) await this.fillDue(now);
    return toDto((await this.expenseRepository.findById(id))!);
  }

  async remove(id: number, actorId: number): Promise<void> {
    const expense = await this.expenseRepository.findById(id);
    if (!expense) throw new NotFoundError(`Expense ${id} does not exist`);
    await this.transactions.run(async (repos) => {
      await repos.expenses.remove(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'expense.removed',
        entityType: 'expense',
        entityId: id,
        summary: `Removed the ${formatEuro(Number(expense.amount))} ${expense.category} expense of ${expense.day}`,
        details: { ...toDto(expense) },
      });
    });
  }

  async stopRepeating(id: number, actorId: number, now = new Date()): Promise<void> {
    const rule = await this.expenseRepository.findRecurringById(id);
    if (!rule) throw new NotFoundError(`Repeating expense ${id} does not exist`);
    if (rule.stopped_at) throw new ConflictError('This expense has already stopped repeating');
    await this.transactions.run(async (repos) => {
      await repos.expenses.stopRecurring(id, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'expense.repeat_stopped',
        entityType: 'expense',
        entityId: null,
        summary: `Stopped the monthly ${rule.category} expense`,
        details: { recurringId: id },
      });
    });
  }

  /**
   * Adds each monthly rule's expense for every month whose day has come.
   * Called every minute by the server; safe to run twice. Returns how many it added.
   */
  async fillDue(now = new Date()): Promise<number> {
    const today = zonedDay(now, this.timeZone);
    let added = 0;
    for (const rule of await this.expenseRepository.findActiveRecurring()) {
      let next = nextMonthDay(rule.last_filled_on, rule.day_of_month);
      while (next <= today) {
        const day = next;
        await this.transactions.run(async (repos) => {
          const id = await repos.expenses.add({
            day,
            amount: Number(rule.amount),
            category: rule.category,
            place: rule.place,
            carwashId: rule.carwash_id,
            note: rule.note,
            recurringId: rule.id,
            createdBy: null,
          });
          if (id !== null) added += 1;
          await repos.expenses.markFilled(rule.id, day);
        });
        next = nextMonthDay(day, rule.day_of_month);
      }
    }
    return added;
  }
}
