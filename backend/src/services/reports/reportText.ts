import type { ServerMessages } from '../../i18n/messages.js';
import type { Report } from './ReportBuilder.js';

/** The report as plain lines under each section's name, for the email. */
export function reportText(report: Report, t: ServerMessages): Array<{ heading: string; lines: string[] }> {
  const l = t.report.lines;
  const s = report.sections;
  const out: Array<{ heading: string; lines: string[] }> = [];
  const add = (key: keyof Report['sections'], lines: string[]) => out.push({ heading: t.report.sections[key]!, lines: lines.length > 0 ? lines : [l.none] });

  if (s.sales) {
    const change = s.sales.change === null ? null : Math.round(s.sales.change * 100);
    add('sales', [
      l.revenue({ revenue: s.sales.revenue, change }),
      l.profit({ profit: s.sales.profit, margin: s.sales.margin, net: s.sales.netProfit }),
      l.count({ sales: s.sales.salesCount, units: s.sales.unitsSold, average: s.sales.averageSale }),
    ]);
  }
  if (s.products) add('products', s.products.map((row) => l.product({ name: row.name, units: row.unitsSold, revenue: row.revenue })));
  if (s.team) add('team', s.team.map((row) => l.person({ name: row.name, sales: row.salesCount, revenue: row.revenue })));
  if (s.losses) add('losses', [l.losses(s.losses)]);
  if (s.carwash) add('carwash', s.carwash.each.map((row) => l.carwash({ name: row.name, total: row.total })));
  if (s.cash) add('cash', s.cash.map((row) => l.cash(row)));
  if (s.expenses) {
    add('expenses', s.expenses.total > 0 ? [l.expensesTotal(s.expenses.total), ...s.expenses.byCategory.map((row) => l.expense(row))] : []);
  }
  if (s.tabs) {
    add('tabs', s.tabs.owed > 0 ? [l.tabs({ owed: s.tabs.owed, customers: s.tabs.customers }), ...s.tabs.overdue.map((row) => l.tabOverdue(row))] : []);
  }
  if (s.bills) {
    add('bills', [
      l.billsOwed({ owed: s.bills.owed, overdue: s.bills.overdue.amount, overdueCount: s.bills.overdue.count, dueSoon: s.bills.dueSoon.amount }),
      ...(s.bills.paid.count > 0 ? [l.billsPaid(s.bills.paid)] : []),
      ...s.bills.next.map((bill) => l.bill(bill)),
    ]);
  }
  if (s.stock) {
    add(
      'stock',
      (['soldOut', 'runningOut', 'expiring'] as const).filter((label) => s.stock![label].length > 0).map((label) => l.stockList({ label, names: s.stock![label] })),
    );
  }
  if (s.approvals) add('approvals', s.approvals.total > 0 ? [l.approvals(s.approvals.total)] : []);
  return out;
}
