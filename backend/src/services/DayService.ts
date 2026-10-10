import type { UserRole } from '../database/types.js';
import { ValidationError } from '../errors/httpErrors.js';
import type { CashPlace } from '../repositories/CashCountRepository.js';
import type { ExpenseRepository } from '../repositories/ExpenseRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { canOversee } from '../utils/roles.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { ApprovalService } from './ApprovalService.js';
import type { CarwashService, CarwashTakings } from './CarwashService.js';
import type { CashCountDto, CashCountService } from './CashCountService.js';
import type { ExpenseDto, ExpenseService } from './ExpenseService.js';

/**
 * One thing that closes the day. Defined here only: the dashboard's Day page
 * and the team app's End your shift both read these steps.
 */
export type DayStep =
  | { kind: 'drawer'; key: string; place: CashPlace; carwashId: number | null; name: string | null; done: boolean; countedBy: string | null }
  | { kind: 'carwash'; key: string; carwashId: number; name: string; done: boolean }
  | { kind: 'expenses'; key: 'expenses'; done: boolean; count: number; total: number; noneMarked: boolean; noneMarkedBy: string | null }
  | { kind: 'requests'; key: 'requests'; done: boolean; waiting: number };

export interface DayDto {
  /** "2026-10-10", in shop time. */
  day: string;
  /** Today in shop time, so the apps know whether the day is still running. */
  today: string;
  steps: DayStep[];
  /** Steps done, out of `total`. */
  done: number;
  total: number;
  /** Every step is done. Nothing is locked either way. */
  allDone: boolean;
  /** What happened that day, for the people who oversee the money; null for staff (they count blind). */
  details: {
    counts: CashCountDto[];
    carwash: Array<{ id: number; name: string; takings: CarwashTakings | null }>;
    expenses: ExpenseDto[];
  } | null;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The shop day: is every drawer counted, every carwash entered, the day's
 * spending added and every request answered. It only reports; it never locks
 * the day, and anything can still be changed afterwards.
 */
export class DayService {
  constructor(
    private readonly cashCountService: CashCountService,
    private readonly carwashService: CarwashService,
    private readonly expenseService: ExpenseService,
    private readonly expenseRepository: ExpenseRepository,
    private readonly approvalService: ApprovalService,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  /**
   * One day as `role` sees it. Overseers may look at any past day and get
   * every step with the day's details; everyone else gets today and only the
   * steps they close at the counter (drawers and carwash takings).
   */
  async forDay(role: UserRole, day?: string, now = new Date()): Promise<DayDto> {
    const today = zonedDay(now, this.timeZone);
    const oversees = canOversee(role);
    const date = oversees && day !== undefined ? this.validDay(day, today) : today;

    const [drawers, carwashes, expenses, noneMark, approvals, counts] = await Promise.all([
      this.cashCountService.drawersOn(date),
      this.carwashService.onDay(date),
      oversees ? this.expenseService.onDay(date) : [],
      oversees ? this.expenseRepository.findNoExpenseMark(date) : undefined,
      // Requests are about now, not a past day.
      oversees && date === today ? this.approvalService.summary() : undefined,
      oversees ? this.cashCountService.onDay(date) : [],
    ]);

    const steps: DayStep[] = [
      ...drawers.map((drawer) => ({
        kind: 'drawer' as const,
        key: drawer.place === 'shop' ? 'shop' : `carwash:${drawer.carwashId}`,
        place: drawer.place,
        carwashId: drawer.carwashId,
        name: drawer.name,
        done: drawer.countedAt !== null,
        countedBy: drawer.countedBy,
      })),
      ...carwashes.map((carwash) => ({
        kind: 'carwash' as const,
        key: `takings:${carwash.id}`,
        carwashId: carwash.id,
        name: carwash.name,
        done: carwash.takings !== null,
      })),
    ];
    if (oversees) {
      steps.push({
        kind: 'expenses',
        key: 'expenses',
        done: expenses.length > 0 || noneMark !== undefined,
        count: expenses.length,
        total: roundMoney(expenses.reduce((sum, expense) => sum + expense.amount, 0)),
        noneMarked: noneMark !== undefined,
        noneMarkedBy: noneMark?.marked_by_name ?? null,
      });
    }
    if (approvals) steps.push({ kind: 'requests', key: 'requests', done: approvals.total === 0, waiting: approvals.total });

    const done = steps.filter((step) => step.done).length;
    return {
      day: date,
      today,
      steps,
      done,
      total: steps.length,
      allDone: done === steps.length,
      details: oversees
        ? {
            counts,
            carwash: carwashes.map((carwash) => ({ id: carwash.id, name: carwash.name, takings: carwash.takings })),
            expenses,
          }
        : null,
    };
  }

  /** A manager says a day had no expenses (or takes that back), so its list can close. */
  async setNoExpenses(none: boolean, actorId: number, role: UserRole, day?: string, now = new Date()): Promise<DayDto> {
    const date = day === undefined ? zonedDay(now, this.timeZone) : this.validDay(day, zonedDay(now, this.timeZone));
    await this.transactions.run(async (repos) => {
      if (none) await repos.expenses.markNoExpenses(date, actorId);
      else await repos.expenses.unmarkNoExpenses(date);
      await repos.activityLog.create({
        userId: actorId,
        action: none ? 'expense.none_marked' : 'expense.none_cleared',
        entityType: 'expense',
        entityId: null,
        summary: none ? `Said ${date} had no expenses` : `Took back "no expenses" for ${date}`,
        details: { day: date },
      });
    });
    return this.forDay(role, date, now);
  }

  private validDay(day: string, today: string): string {
    if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new ValidationError('Pick a date like 2026-10-10');
    if (day > today) throw new ValidationError("That day hasn't happened yet");
    return day;
  }
}
