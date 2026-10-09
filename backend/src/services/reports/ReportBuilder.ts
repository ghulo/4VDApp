import { dayMonth } from '../../i18n/language.js';
import { en, type ServerMessages } from '../../i18n/messages.js';
import type { ReportsRepository } from '../../repositories/ReportsRepository.js';
import type { SupplierBillRepository } from '../../repositories/SupplierBillRepository.js';
import { roundMoney } from '../../utils/money.js';
import { addDays, startOfDay, zonedDay } from '../../utils/zonedDates.js';
import type { ApprovalService } from '../ApprovalService.js';
import type { CarwashService } from '../CarwashService.js';
import type { CashCountService } from '../CashCountService.js';
import type { ExpenseService } from '../ExpenseService.js';
import type { InsightsService } from '../InsightsService.js';
import type { ReportsService } from '../ReportsService.js';
import type { SupplierBillService } from '../SupplierBillService.js';
import type { TabService } from '../TabService.js';

export type ReportKind = 'daily' | 'weekly';

/** The parts of a report, in the order they're shown. Each person picks the ones they want. */
export const REPORT_SECTIONS = ['sales', 'products', 'team', 'losses', 'carwash', 'cash', 'expenses', 'tabs', 'bills', 'stock', 'approvals'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

const TOP_PRODUCTS = 5;
const LIST_LIMIT = 8;
const CASH_MATCH = 0.5;

export interface Report {
  kind: ReportKind;
  /** First and last day covered, both included ("2026-10-09"). */
  from: string;
  to: string;
  /** Compared with: the same weekday last week, or the week before. */
  previousFrom: string;
  previousTo: string;
  /** Still running: today's report before the day is over. */
  partial: boolean;
  generatedAt: string;
  sections: Partial<ReportSections>;
}

export interface ReportSections {
  sales: {
    revenue: number;
    previousRevenue: number;
    change: number | null;
    profit: number;
    margin: number | null;
    salesCount: number;
    unitsSold: number;
    averageSale: number;
    /** Shop profit + carwash − expenses. */
    netProfit: number;
    /** Weekly only: each day's shop revenue. */
    byDay: Array<{ day: string; revenue: number }>;
  };
  products: Array<{ name: string; unitsSold: number; revenue: number; profit: number }>;
  team: Array<{ name: string; salesCount: number; revenue: number; profit: number }>;
  losses: { refunds: number; stockLosses: number };
  carwash: { total: number; each: Array<{ name: string; carwash: number; change: number; total: number }> };
  cash: Array<{ day: string; place: string; counted: number; expected: number | null; difference: number | null }>;
  expenses: { total: number; byCategory: Array<{ category: string; amount: number }> };
  tabs: { owed: number; customers: number; overdue: Array<{ name: string; balance: number }> };
  bills: {
    owed: number;
    overdue: { count: number; amount: number };
    dueSoon: { count: number; amount: number };
    paid: { count: number; total: number };
    /** The most urgent unpaid bills. */
    next: Array<{ supplier: string; number: string | null; left: number; dueOn: string | null; overdue: boolean }>;
  };
  stock: { soldOut: string[]; runningOut: string[]; expiring: string[]; other: number };
  approvals: { total: number; returns: number; writeOffs: number; countLines: number };
}

/**
 * The full daily or weekly report: every part of the business for one day or
 * seven days, against the period before. Built fresh from the same numbers
 * the dashboard shows; the delivery picks the sections each person wants.
 */
export class ReportBuilder {
  constructor(
    private readonly deps: {
      reportsService: ReportsService;
      reportsRepository: ReportsRepository;
      carwashService: CarwashService;
      cashCountService: CashCountService;
      expenseService: ExpenseService;
      tabService: TabService;
      billService: SupplierBillService;
      billRepository: SupplierBillRepository;
      insightsService: InsightsService;
      approvalService: ApprovalService;
    },
    private readonly timeZone: string,
  ) {}

  /** Today's daily report, or the 7 days up to yesterday for the weekly one. */
  latestFrom(kind: ReportKind, now = new Date()): string {
    const today = zonedDay(now, this.timeZone);
    return kind === 'daily' ? today : addDays(today, -7);
  }

  async build(kind: ReportKind, from: string, now = new Date(), t: ServerMessages = en): Promise<Report> {
    const days = kind === 'daily' ? 1 : 7;
    const to = addDays(from, days - 1);
    const previousFrom = addDays(from, -7);
    const previousTo = addDays(previousFrom, days - 1);
    const range = { startDate: startOfDay(from, this.timeZone), endDate: startOfDay(addDays(to, 1), this.timeZone) };
    const previous = { startDate: startOfDay(previousFrom, this.timeZone), endDate: startOfDay(addDays(previousTo, 1), this.timeZone) };
    const d = this.deps;

    const [summary, team, products, byDay, cash, expenses, customers, overdueTabs, bills, open, paid, insights, approvals] = await Promise.all([
      d.reportsService.summary(range, previous),
      d.reportsService.team(range),
      d.reportsService.profit(range, 'product'),
      kind === 'weekly' ? d.reportsRepository.shopRevenueByDay(from, to, this.timeZone) : Promise.resolve(new Map<string, number>()),
      d.cashCountService.list(range),
      d.expenseService.list(range),
      d.tabService.list(),
      d.tabService.overdue(now),
      d.billService.summary(now),
      d.billService.list({ status: 'open' }, now),
      d.billRepository.paidBetween(from, to),
      d.insightsService.list(now, t),
      d.approvalService.summary(),
    ]);
    const current = summary.current;
    const names = (kinds: string[]) => insights.filter((insight) => kinds.includes(insight.kind)).map((insight) => insight.title);
    const stockKinds = ['sold_out', 'running_out', 'expiring'];

    const sections: ReportSections = {
      sales: {
        revenue: current.revenue,
        previousRevenue: summary.previous.revenue,
        change: summary.change.revenue,
        profit: current.profit,
        margin: current.margin,
        salesCount: current.salesCount,
        unitsSold: current.unitsSold,
        averageSale: current.salesCount === 0 ? 0 : roundMoney(current.revenue / current.salesCount),
        netProfit: summary.netProfit.current,
        byDay: Array.from({ length: kind === 'weekly' ? 7 : 0 }, (_, index) => {
          const day = addDays(from, index);
          return { day, revenue: byDay.get(day) ?? 0 };
        }),
      },
      products: [...products]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, TOP_PRODUCTS)
        .map((row) => ({ name: row.name, unitsSold: row.unitsSold, revenue: row.revenue, profit: row.profit })),
      team: team
        .filter((row) => row.salesCount > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .map((row) => ({ name: row.name, salesCount: row.salesCount, revenue: row.revenue, profit: row.profit })),
      losses: { refunds: current.refunds, stockLosses: current.stockLosses },
      carwash: {
        total: summary.carwash.current.total,
        each: summary.carwash.byCarwash.map((row) => ({ name: row.name, carwash: row.carwash, change: row.change, total: row.total })),
      },
      cash: cash.map((count) => ({
        day: count.day,
        place: count.place === 'shop' ? t.report.shop : (count.carwashName ?? t.report.carwash),
        counted: count.counted,
        expected: count.expected,
        // Off by less than 50 cents counts as a match.
        difference: count.difference !== null && Math.abs(count.difference) < CASH_MATCH ? 0 : count.difference,
      })),
      expenses: {
        total: expenses.totals.total,
        byCategory: Object.entries(expenses.totals.byCategory)
          .filter(([, amount]) => amount > 0)
          .sort(([, a], [, b]) => b - a)
          .map(([category, amount]) => ({ category, amount })),
      },
      tabs: {
        owed: roundMoney(customers.reduce((sum, customer) => sum + customer.balance, 0)),
        customers: customers.filter((customer) => customer.balance > 0).length,
        overdue: overdueTabs.slice(0, LIST_LIMIT).map((customer) => ({ name: customer.name, balance: customer.balance })),
      },
      bills: {
        owed: bills.owed,
        overdue: bills.overdue,
        dueSoon: bills.dueSoon,
        paid,
        next: open
          .filter((bill) => bill.dueOn !== null)
          .slice(0, LIST_LIMIT)
          .map((bill) => ({ supplier: bill.supplier.name, number: bill.number, left: bill.left, dueOn: bill.dueOn, overdue: bill.overdue })),
      },
      stock: {
        soldOut: names(['sold_out']).slice(0, LIST_LIMIT),
        runningOut: names(['running_out']).slice(0, LIST_LIMIT),
        expiring: names(['expiring']).slice(0, LIST_LIMIT),
        other: insights.filter((insight) => !stockKinds.includes(insight.kind)).length,
      },
      approvals,
    };

    const today = zonedDay(now, this.timeZone);
    return {
      kind,
      from,
      to,
      previousFrom,
      previousTo,
      partial: to >= today,
      generatedAt: now.toISOString(),
      sections,
    };
  }
}

/** Only the sections a person chose; null means all of them. */
export function pickSections(report: Report, chosen: readonly string[] | null): Report {
  if (chosen === null) return report;
  return {
    ...report,
    sections: Object.fromEntries(Object.entries(report.sections).filter(([key]) => chosen.includes(key))) as Partial<ReportSections>,
  };
}

/** "9 Oct" or "2 Oct – 8 Oct", in the reader's language. */
export function reportPeriod(report: Pick<Report, 'kind' | 'from' | 'to'>, t: ServerMessages): string {
  // Noon UTC is the same calendar day in every zone the shop could be in.
  const day = (value: string) => dayMonth(new Date(`${value}T12:00:00Z`), t.language, 'UTC');
  return report.kind === 'daily' ? day(report.from) : `${day(report.from)} – ${day(report.to)}`;
}

/** The alert's title and one line: the headline numbers and what needs a look. */
export function reportHeadline(report: Report, t: ServerMessages): { title: string; message: string } {
  const { sales, bills, stock, approvals } = report.sections;
  const title = t.report.title({ kind: report.kind, period: reportPeriod(report, t), revenue: sales?.revenue ?? null });
  const parts = [
    sales && t.report.salesLine({ sales: sales.salesCount, profit: sales.profit, change: sales.change === null ? null : Math.round(sales.change * 100) }),
    bills && bills.overdue.count > 0 ? t.report.billsLine(bills.overdue) : null,
    stock && stock.soldOut.length + stock.runningOut.length > 0 ? t.report.stockLine(stock.soldOut.length + stock.runningOut.length) : null,
    approvals && approvals.total > 0 ? t.report.approvalsLine(approvals.total) : null,
  ].filter(Boolean);
  return { title, message: parts.length > 0 ? parts.join(' · ') : t.report.nothing };
}
