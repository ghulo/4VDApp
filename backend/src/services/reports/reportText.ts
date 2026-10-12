import { dayMonth, money, wholeMoney } from '../../i18n/language.js';
import type { ServerMessages } from '../../i18n/messages.js';
import type { Report } from './ReportBuilder.js';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/** A metric card: spec label, big figure, a hint, and the change in words. */
export interface ReportFigure {
  label: string;
  value: string;
  hint?: string;
  change?: { text: string; tone: Tone };
}

/** One table row: name on the left (with a quiet detail), the amount on the right. */
export interface ReportRow {
  label: string;
  detail?: string;
  value?: string;
  /** Colours the value, with words already saying what it means. */
  tone?: Tone;
  stamp?: { text: string; tone: Tone };
  /** A total line under the rows. */
  total?: boolean;
}

export interface ReportBlock {
  heading: string;
  figures?: ReportFigure[];
  /** Weekly sales per day, drawn as ink bars. */
  bars?: Array<{ label: string; value: string; amount: number }>;
  rows: ReportRow[];
}

/** The report as the email shows it: the same parts as the report page, in report order. */
export function reportBlocks(report: Report, t: ServerMessages): ReportBlock[] {
  const l = t.report.lines;
  const s = report.sections;
  const cash = (amount: number) => money(amount, t.language);
  // Headline figures of €1,000 or more drop the cents (DESIGN.md 10.6).
  const figure = (amount: number) => (Math.abs(amount) >= 1000 ? wholeMoney(Math.round(amount), t.language) : cash(amount));
  const day = (value: string) => dayMonth(new Date(`${value}T12:00:00Z`), t.language, 'UTC');
  const out: ReportBlock[] = [];
  const add = (key: keyof Report['sections'], rows: ReportRow[], extra: Partial<ReportBlock> = {}) =>
    out.push({ heading: t.report.sections[key]!, rows: rows.length > 0 || extra.figures ? rows : [{ label: l.none }], ...extra });

  if (s.sales) {
    const change = s.sales.change === null ? null : Math.round(s.sales.change * 100);
    const top = Math.max(0, ...s.sales.byDay.map((row) => row.revenue));
    add('sales', [], {
      figures: [
        {
          label: l.revenue,
          value: figure(s.sales.revenue),
          hint: l.before(s.sales.previousRevenue),
          ...(change === null ? {} : { change: { text: l.change(change), tone: change >= 0 ? 'ok' : 'danger' } }),
        },
        { label: l.profit, value: figure(s.sales.profit), ...(s.sales.margin === null ? {} : { hint: l.margin(s.sales.margin) }) },
        { label: l.net, value: figure(s.sales.netProfit), hint: l.netHint },
        { label: l.salesCount, value: String(s.sales.salesCount), hint: l.units({ units: s.sales.unitsSold, average: s.sales.averageSale }) },
      ],
      ...(report.kind === 'weekly' && top > 0
        ? { bars: s.sales.byDay.map((row) => ({ label: day(row.day), value: cash(row.revenue), amount: row.revenue / top })) }
        : {}),
    });
  }
  if (s.products) add('products', s.products.map((row) => ({ label: row.name, detail: l.sold(row.unitsSold), value: cash(row.revenue) })));
  if (s.team) add('team', s.team.map((row) => ({ label: row.name, detail: l.sales(row.salesCount), value: cash(row.revenue) })));
  if (s.losses) {
    add('losses', [
      { label: l.refunds, value: cash(s.losses.refunds) },
      { label: l.stockLosses, value: cash(s.losses.stockLosses) },
    ]);
  }
  if (s.carwash) add('carwash', s.carwash.each.map((row) => ({ label: row.name, value: cash(row.total) })));
  if (s.cash) {
    add(
      'cash',
      s.cash.map((row) => ({
        label: report.kind === 'weekly' ? `${day(row.day)} · ${row.place}` : row.place,
        detail: l.float(row.float),
        ...(row.difference === null
          ? { value: l.counted }
          : row.difference === 0
            ? { value: l.matched, tone: 'ok' as const }
            : row.difference < 0
              ? { value: l.short(-row.difference), tone: 'danger' as const }
              : { value: l.over(row.difference), tone: 'warn' as const }),
      })),
    );
  }
  if (s.expenses) {
    add(
      'expenses',
      s.expenses.total > 0
        ? [...s.expenses.byCategory.map((row) => ({ label: row.category, value: cash(row.amount) })), { label: l.total, value: cash(s.expenses.total), total: true }]
        : [],
    );
  }
  if (s.tabs) {
    add(
      'tabs',
      s.tabs.owed > 0
        ? [
            ...s.tabs.overdue.map((row) => ({ label: row.name, value: cash(row.balance), stamp: { text: l.overdue, tone: 'danger' as const } })),
            { label: l.owedBy(s.tabs.customers), value: cash(s.tabs.owed), total: true },
          ]
        : [],
    );
  }
  if (s.bills) {
    const b = s.bills;
    add('bills', [
      ...b.next.map((bill) => ({
        label: bill.supplier,
        ...(bill.dueOn ? { detail: l.due({ day: day(bill.dueOn), overdue: bill.overdue }) } : {}),
        value: cash(bill.left),
        ...(bill.overdue ? { stamp: { text: l.overdue, tone: 'danger' as const } } : {}),
      })),
      ...(b.overdue.count > 0 ? [{ label: l.overdue, value: cash(b.overdue.amount), tone: 'danger' as const }] : []),
      { label: l.dueSoon, value: cash(b.dueSoon.amount) },
      ...(b.paid.count > 0 ? [{ label: l.paid(b.paid.count), value: cash(b.paid.total), tone: 'ok' as const }] : []),
      { label: l.owed, value: cash(b.owed), total: true },
    ]);
  }
  if (s.stock) {
    const tones = { soldOut: 'danger', runningOut: 'warn', expiring: 'info' } as const;
    add(
      'stock',
      (['soldOut', 'runningOut', 'expiring'] as const)
        .filter((label) => s.stock![label].length > 0)
        .map((label) => ({ label: s.stock![label].join(', '), stamp: { text: l.stock[label], tone: tones[label] } })),
    );
  }
  if (s.approvals) add('approvals', s.approvals.total > 0 ? [{ label: l.waiting, value: String(s.approvals.total), tone: 'warn' as const }] : []);
  return out;
}

/** The same blocks as plain lines, for the email's text part. */
export function blocksText(blocks: ReportBlock[]): string[] {
  return blocks.map((block) => {
    const figures = (block.figures ?? []).map((f) => `${f.label}: ${f.value}${f.change ? ` (${f.change.text})` : ''}${f.hint ? `, ${f.hint}` : ''}`);
    const bars = (block.bars ?? []).map((bar) => `${bar.label}: ${bar.value}`);
    const rows = block.rows.map(
      (row) => `${row.stamp ? `[${row.stamp.text}] ` : ''}${row.label}${row.detail ? ` (${row.detail})` : ''}${row.value ? `: ${row.value}` : ''}`,
    );
    return [block.heading, ...figures, ...bars, ...rows].join('\n');
  });
}
