import type { ExpenseRepository } from '../repositories/ExpenseRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { ApprovalService } from './ApprovalService.js';
import type { CarwashService } from './CarwashService.js';
import type { CashCountService, CashPlaceToday } from './CashCountService.js';

export interface DayChecklist {
  /** "2026-10-10", in shop time. */
  day: string;
  cash: { done: boolean; drawers: CashPlaceToday[] };
  /** Null when the business has no open carwash. */
  carwash: { done: boolean; carwashes: Array<{ id: number; name: string; entered: boolean }> } | null;
  expenses: { done: boolean; count: number; total: number; noneMarkedBy: string | null; noneMarked: boolean };
  approvals: { done: boolean; waiting: number };
  /** Every item is done. Nothing is locked either way. */
  done: boolean;
}

/**
 * The end-of-day checklist: is the cash counted, the carwash entered, today's
 * spending added and every request answered. It only reports; it never locks
 * the day, and anything can still be changed afterwards.
 */
export class DayService {
  constructor(
    private readonly cashCountService: CashCountService,
    private readonly carwashService: CarwashService,
    private readonly expenseRepository: ExpenseRepository,
    private readonly approvalService: ApprovalService,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async today(now = new Date()): Promise<DayChecklist> {
    const day = zonedDay(now, this.timeZone);
    const [drawers, carwash, expenses, noneMark, approvals] = await Promise.all([
      this.cashCountService.today(now),
      this.carwashService.today(now),
      this.expenseRepository.findBetween(day, day),
      this.expenseRepository.findNoExpenseMark(day),
      this.approvalService.summary(),
    ]);
    const carwashes = carwash.carwashes.map((place) => ({ id: place.id, name: place.name, entered: place.takings !== null }));
    const items = {
      cash: { done: drawers.every((drawer) => drawer.countedAt !== null), drawers },
      carwash: carwashes.length > 0 ? { done: carwashes.every((place) => place.entered), carwashes } : null,
      expenses: {
        done: expenses.length > 0 || noneMark !== undefined,
        count: expenses.length,
        total: roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount), 0)),
        noneMarked: noneMark !== undefined,
        noneMarkedBy: noneMark?.marked_by_name ?? null,
      },
      approvals: { done: approvals.total === 0, waiting: approvals.total },
    };
    return {
      day,
      ...items,
      done: items.cash.done && (items.carwash?.done ?? true) && items.expenses.done && items.approvals.done,
    };
  }

  /** A manager says today had no expenses (or takes that back), so the list can close. */
  async setNoExpenses(none: boolean, actorId: number, now = new Date()): Promise<DayChecklist> {
    const day = zonedDay(now, this.timeZone);
    await this.transactions.run(async (repos) => {
      if (none) await repos.expenses.markNoExpenses(day, actorId);
      else await repos.expenses.unmarkNoExpenses(day);
      await repos.activityLog.create({
        userId: actorId,
        action: none ? 'expense.none_marked' : 'expense.none_cleared',
        entityType: 'expense',
        entityId: null,
        summary: none ? `Said ${day} had no expenses` : `Took back "no expenses" for ${day}`,
        details: { day },
      });
    });
    return this.today(now);
  }
}
