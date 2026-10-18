import type { UserRole } from '../database/types.js';
import { en, type ServerMessages } from '../i18n/messages.js';
import { canOversee, canReadBooks, canSell } from '../utils/roles.js';
import { zonedDay, zonedHour } from '../utils/zonedDates.js';
import type { BillScanRepository } from '../repositories/BillScanRepository.js';
import type { ApprovalService } from './ApprovalService.js';
import type { CashCountService } from './CashCountService.js';
import type { DayService } from './DayService.js';
import type { DuplicateService } from './DuplicateService.js';
import type { Insight, InsightKind, InsightSeverity, InsightsService } from './InsightsService.js';
import type { ThreadService } from './ThreadService.js';
import { DUE_DAY, addMonths, type VatService } from './vat/VatService.js';
import type { YearService } from './statements/YearService.js';

/** From this hour (shop time) an unfinished day or shift becomes something to do. */
export const CLOSING_HOUR = 18;
/** Cash differences older than this stop asking to be checked. */
const CASH_CHECK_DAYS = 30;

export type TodoSeverity = 'urgent' | 'check' | 'idea';
/** What the item's one button does; each app words it in its own language. */
export type TodoVerb = 'decide' | 'restock' | 'checkExpiry' | 'look' | 'openTab' | 'payBill' | 'markChecked' | 'closeDay' | 'endShift' | 'checkBill' | 'reviewDuplicates' | 'fileVat' | 'payTm' | 'answer';
export type TodoKind = InsightKind | 'requests' | 'cash_difference' | 'close_day' | 'end_shift' | 'bill_scan' | 'duplicates' | 'vat_due' | 'tm_due' | 'question';

export interface TodoItem {
  /** Stable while the cause lasts, so lists don't jump. */
  key: string;
  kind: TodoKind;
  severity: TodoSeverity;
  title: string;
  detail: string;
  verb: TodoVerb;
  /** The dashboard page that fixes it. */
  to: string;
  productId?: number;
  customerId?: number;
  cashCountId?: number;
}

export interface Attention {
  todo: TodoItem[];
  /** What every badge and "waiting" number shows: Urgent and Check items. Ideas never nag. */
  count: number;
}

const SEVERITY: Record<InsightSeverity, TodoSeverity> = { urgent: 'urgent', warning: 'check', info: 'idea' };
const ORDER: Record<TodoSeverity, number> = { urgent: 0, check: 1, idea: 2 };

const VERB: Record<InsightKind, TodoVerb> = {
  sold_out: 'restock',
  running_out: 'restock',
  expiring: 'checkExpiry',
  missing_stock: 'look',
  unusual_sale: 'look',
  below_cost: 'look',
  dead_stock: 'look',
  tab_overdue: 'openTab',
  bill_overdue: 'payBill',
  bill_due_soon: 'payBill',
};

function fromInsight(insight: Insight): TodoItem {
  const to = insight.billId
    ? `/bills/${insight.billId}`
    : insight.customerId
      ? `/customers/${insight.customerId}`
      : `/inventory/${insight.productId}`;
  return {
    key: `${insight.kind}:${insight.billId ?? insight.customerId ?? insight.productId}`,
    kind: insight.kind,
    severity: SEVERITY[insight.severity],
    title: insight.title,
    detail: insight.detail,
    verb: VERB[insight.kind],
    to,
    ...(insight.productId !== null && { productId: insight.productId }),
    ...(insight.customerId !== undefined && { customerId: insight.customerId }),
  };
}

/**
 * The one source of "what needs attention" (DESIGN.md 3.3). Every item is
 * worked out from the shop as it is now, so it clears itself when the cause
 * is gone; nobody marks a To do as read. The Inbox badge, the Inbox, the
 * Overview and team-app Home all read this list.
 */
export class AttentionService {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly approvalService: ApprovalService,
    private readonly cashCountService: CashCountService,
    private readonly dayService: DayService,
    private readonly billScans: BillScanRepository,
    private readonly duplicates: DuplicateService,
    private readonly vat: VatService,
    private readonly threads: ThreadService,
    private readonly years: YearService,
    private readonly timeZone: string,
  ) {}

  async forUser(role: UserRole, t: ServerMessages = en, now = new Date()): Promise<Attention> {
    const todo = canOversee(role)
      ? [...(await this.overseer(role, t, now)), ...(await this.books(t, now)), ...(await this.questions(t))]
      : canReadBooks(role)
        ? await this.books(t, now)
        : canSell(role)
          ? await this.counter(role, t, now)
          : [];
    todo.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    return { todo, count: todo.filter((item) => item.severity !== 'idea').length };
  }

  /** Overseers: requests, the shop's state, unchecked cash and, from closing time, the day. */
  private async overseer(role: UserRole, t: ServerMessages, now: Date): Promise<TodoItem[]> {
    const [approvals, insights, cash, day, scans, duplicates] = await Promise.all([
      this.approvalService.summary(),
      this.insightsService.list(now, t),
      this.cashCountService.unchecked(CASH_CHECK_DAYS, now),
      this.closingDay(role, now),
      this.billScans.findWaiting(),
      this.duplicates.countOpen(),
    ]);
    const items: TodoItem[] = [];
    if (approvals.total > 0) {
      items.push({
        key: 'requests',
        kind: 'requests',
        severity: 'urgent',
        title: t.todo.requestsTitle(approvals.total),
        detail: t.todo.requestsDetail,
        verb: 'decide',
        to: '/inbox',
      });
    }
    for (const scan of scans) {
      const reading = scan.reading as { supplier?: { name?: string | null }; number?: string | null };
      items.push({
        key: `bill_scan:${scan.id}`,
        kind: 'bill_scan',
        severity: 'check',
        title: t.todo.billScanTitle(reading.supplier?.name ?? null),
        detail: t.todo.billScanDetail({ name: scan.scanned_by_name, number: reading.number ?? null }),
        verb: 'checkBill',
        to: `/bills/scans/${scan.id}`,
      });
    }
    for (const count of cash) {
      items.push({
        key: `cash_difference:${count.id}`,
        kind: 'cash_difference',
        severity: 'check',
        title: t.cashDifferenceTitle({ place: count.place, carwash: count.carwashName, difference: count.difference! }),
        detail: t.todo.cashDetail({ name: count.countedBy, day: count.day }),
        verb: 'markChecked',
        to: `/day?date=${count.day}`,
        cashCountId: count.id,
      });
    }
    if (duplicates > 0) {
      items.push({
        key: 'duplicates',
        kind: 'duplicates',
        severity: 'check',
        title: t.todo.duplicatesTitle(duplicates),
        detail: t.todo.duplicatesDetail,
        verb: 'reviewDuplicates',
        to: '/inventory/duplicates',
      });
    }
    if (day && !day.allDone) {
      items.push({
        key: 'close_day',
        kind: 'close_day',
        severity: 'check',
        title: t.todo.closeDayTitle(day.total - day.done),
        detail: t.todo.closeDayDetail,
        verb: 'closeDay',
        to: '/day',
      });
    }
    return [...items, ...insights.map(fromInsight)];
  }

  /** Staff at the counter: only their shift, from closing time. */
  private async counter(role: UserRole, t: ServerMessages, now: Date): Promise<TodoItem[]> {
    const day = await this.closingDay(role, now);
    if (!day || day.allDone) return [];
    return [
      {
        key: 'end_shift',
        kind: 'end_shift',
        severity: 'check',
        title: t.todo.shiftTitle(day.total - day.done),
        detail: t.todo.shiftDetail,
        verb: 'endShift',
        to: '/day',
      },
    ];
  }

  /**
   * "September VAT is due by 20 October", from the 1st of the month after
   * until the month is marked as filed; urgent once the 20th has passed. Also
   * "Profit tax for Q3 is due by 15 October" for a quarter over with tax to pay
   * and no instalment marked as paid.
   */
  private async books(t: ServerMessages, now: Date): Promise<TodoItem[]> {
    const today = zonedDay(now, this.timeZone);
    const [months, instalments] = await Promise.all([this.vat.unfiled(now), this.years.dueInstalments(now)]);
    const tm = instalments.map(
      (item): TodoItem => ({
        key: `tm_due:${item.year}-${item.quarter}`,
        kind: 'tm_due',
        severity: item.late ? 'urgent' : 'check',
        title: t.todo.tmDueTitle(item),
        detail: t.todo.tmDueDetail(item),
        verb: 'payTm',
        to: `/books/year?year=${item.year}`,
      }),
    );
    const vat = months.map((month): TodoItem => {
      const due = `${addMonths(`${month}-01`, 1).slice(0, 7)}-${String(DUE_DAY).padStart(2, '0')}`;
      const late = today > due;
      return {
        key: `vat_due:${month}`,
        kind: 'vat_due',
        severity: late ? 'urgent' : 'check',
        title: t.todo.vatDueTitle(month),
        detail: t.todo.vatDueDetail(late),
        verb: 'fileVat',
        to: `/books/vat?month=${month}`,
      };
    });
    return [...vat, ...tm];
  }

  /** Questions the accountant left on documents, until someone answers. */
  private async questions(t: ServerMessages): Promise<TodoItem[]> {
    const open = await this.threads.open();
    return open.map((question) => ({
      key: `question:${question.threadId}`,
      kind: 'question',
      severity: 'check',
      title: t.todo.questionTitle({ kind: question.kind, label: question.label }),
      detail: t.todo.questionDetail({ name: question.askedBy, text: question.text }),
      verb: 'answer',
      to: question.kind === 'bill' ? `/bills/${question.id}` : question.kind === 'document' ? `/documents/${question.id}` : `/books/journal?entry=${question.id}`,
    }));
  }

  /** Today's steps as this person sees them, but only once it's closing time. */
  private closingDay(role: UserRole, now: Date) {
    return zonedHour(now, this.timeZone) >= CLOSING_HOUR ? this.dayService.forDay(role, undefined, now) : Promise.resolve(null);
  }
}
