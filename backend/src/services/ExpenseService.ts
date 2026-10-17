import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpensePlace } from '../constants/expenses.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { ExpenseRecord, ExpenseRepository } from '../repositories/ExpenseRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { zonedDay, zonedDays } from '../utils/zonedDates.js';
import { assertMonthsOpen } from './vat/periodLock.js';
import type { CarwashService } from './CarwashService.js';
import type { DateRange } from './reports/calculations.js';
import { type BillRepeatDto, createBill, type SupplierBillService, voidBill } from './SupplierBillService.js';

export { LAST_REPEAT_DAY, nextMonthDay } from './SupplierBillService.js';

export interface ExpenseDto {
  id: number;
  /** The bill it is on: an expense is a bill paid on the spot. */
  billId: number;
  day: string;
  /** Negative for a return or credit. */
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  /** Which carwash, for a carwash expense. */
  carwashId: number | null;
  carwashName: string | null;
  note: string | null;
  /** Set when a monthly repeat made it. */
  recurringId: number | null;
  addedBy: string | null;
  supplierName: string | null;
  /** Paid when entered; a cost on a bill to pay later is changed on its bill. */
  paidNow: boolean;
}

export interface ExpenseTotals {
  total: number;
  byPlace: Record<ExpensePlace, number>;
  /** The carwash part of `byPlace`, split by carwash. */
  byCarwash: Array<{ carwashId: number; name: string; total: number }>;
  byCategory: Record<ExpenseCategory, number>;
}

export type RecurringExpenseDto = BillRepeatDto;

export interface NewExpenseInput {
  day: string;
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  /** For a carwash expense; left out means the only open carwash. */
  carwashId?: number;
  /** Who was paid, when it was a supplier. */
  supplierId?: number | null;
  note: string | null;
  repeatMonthly: boolean;
}

const toDto = (row: ExpenseRecord): ExpenseDto => ({
  id: row.id,
  billId: row.bill_id,
  day: row.day,
  amount: Number(row.amount),
  category: row.category,
  place: row.place,
  carwashId: row.carwash_id,
  carwashName: row.carwash_name,
  note: row.note,
  recurringId: row.recurring_id,
  addedBy: row.created_by_name,
  supplierName: row.supplier_name,
  paidNow: row.paid_now,
});

/**
 * What the business spends, for the shop, the carwash or both, so reports
 * can show real profit. Every cost is a bill line underneath: an expense is a
 * bill paid on the spot, and rent and wages repeat by themselves every month.
 */
export class ExpenseService {
  constructor(
    private readonly expenseRepository: ExpenseRepository,
    private readonly transactions: TransactionManager,
    private readonly carwashService: CarwashService,
    private readonly billService: SupplierBillService,
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
      byCategory[expense.category] = roundMoney((byCategory[expense.category] ?? 0) + expense.amount);
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

  /** Monthly repeats, of expenses and of bills to pay later alike. */
  async recurring(): Promise<RecurringExpenseDto[]> {
    return this.billService.repeats();
  }

  /** An expense paid on the spot: a bill with one cost line, paid from cash. */
  async add(input: NewExpenseInput, actorId: number, now = new Date()): Promise<ExpenseDto> {
    const today = zonedDay(now, this.timeZone);
    if (input.day > today) throw new ValidationError("An expense can't be for a day that hasn't happened yet");
    const carwash = input.place === 'carwash' ? await this.carwashService.resolve(input.carwashId) : null;
    const carwashId = carwash?.id ?? null;

    const billId = await this.transactions.run(async (repos) => {
      // Unlike a supplier's late bill, an expense typed for a filed month is a mistake: refused.
      await assertMonthsOpen(repos.periods, [input.day]);
      const id = (await createBill(
        repos,
        {
          supplierId: input.supplierId ?? null,
          number: null,
          issuedOn: input.day,
          dueOn: null,
          note: input.note,
          lines: [{ kind: 'cost', category: input.category, amount: input.amount, vatRate: 0 }],
          pricesIncludeVat: true,
          paidNow: { method: 'cash' },
          place: input.place,
          carwashId,
          repeatMonthly: input.repeatMonthly,
        },
        actorId,
        { today, quiet: true },
      ))!;
      await repos.activityLog.create({
        userId: actorId,
        action: 'expense.added',
        entityType: 'expense',
        entityId: id,
        say: { key: 'expenseAdded', params: { amount: input.amount, category: input.category, at: carwash ? { carwash: carwash.name } : { place: input.place }, day: input.day, monthly: Boolean(input.repeatMonthly) } },
        details: { ...input, carwashId, billId: id },
      });
      return id;
    });
    // A monthly repeat started in the past fills in the months since.
    if (input.repeatMonthly) await this.fillDue(now);
    return toDto((await this.expenseRepository.findByBill(billId))!);
  }

  /** Crosses out an expense paid on the spot, with its payment. A cost on a bill to pay later is changed on its bill. */
  async remove(id: number, actorId: number, now = new Date()): Promise<void> {
    const expense = await this.expenseRepository.findById(id);
    if (!expense) throw new NotFoundError(`Expense ${id} does not exist`);
    if (!expense.paid_now) throw new ConflictError('This cost is on a bill to pay later. Open the bill to change it.');
    await this.transactions.run(async (repos) => {
      await voidBill(repos, expense.bill_id, 'Removed from the expenses', actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'expense.removed',
        entityType: 'expense',
        entityId: id,
        say: { key: 'expenseRemoved', params: { amount: Number(expense.amount), category: expense.category, day: String(expense.day) } },
        details: { ...toDto(expense) },
      });
    });
  }

  async stopRepeating(id: number, actorId: number, now = new Date()): Promise<void> {
    await this.billService.stopRepeat(id, actorId, now);
  }

  /** Makes every repeat's bill whose day has come. Called every minute by the server; safe to run twice. */
  async fillDue(now = new Date()): Promise<number> {
    return this.billService.fillRepeats(now);
  }
}
