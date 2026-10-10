import type { UserRole } from '../database/types.js';
import { en, type ServerMessages } from '../i18n/messages.js';
import { canOversee, canSell } from '../utils/roles.js';
import { zonedHour } from '../utils/zonedDates.js';
import type { ApprovalService } from './ApprovalService.js';
import type { CashCountService } from './CashCountService.js';
import type { DayService } from './DayService.js';
import type { Insight, InsightKind, InsightSeverity, InsightsService } from './InsightsService.js';

/** From this hour (shop time) an unfinished day or shift becomes something to do. */
export const CLOSING_HOUR = 18;
/** Cash differences older than this stop asking to be checked. */
const CASH_CHECK_DAYS = 30;

export type TodoSeverity = 'urgent' | 'check' | 'idea';
/** What the item's one button does; each app words it in its own language. */
export type TodoVerb = 'decide' | 'restock' | 'checkExpiry' | 'look' | 'openTab' | 'payBill' | 'markChecked' | 'closeDay' | 'endShift';
export type TodoKind = InsightKind | 'requests' | 'cash_difference' | 'close_day' | 'end_shift';

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
    private readonly timeZone: string,
  ) {}

  async forUser(role: UserRole, t: ServerMessages = en, now = new Date()): Promise<Attention> {
    const todo = canOversee(role) ? await this.overseer(role, t, now) : canSell(role) ? await this.counter(role, t, now) : [];
    todo.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    return { todo, count: todo.filter((item) => item.severity !== 'idea').length };
  }

  /** Overseers: requests, the shop's state, unchecked cash and, from closing time, the day. */
  private async overseer(role: UserRole, t: ServerMessages, now: Date): Promise<TodoItem[]> {
    const [approvals, insights, cash, day] = await Promise.all([
      this.approvalService.summary(),
      this.insightsService.list(now, t),
      this.cashCountService.unchecked(CASH_CHECK_DAYS, now),
      this.closingDay(role, now),
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

  /** Today's steps as this person sees them, but only once it's closing time. */
  private closingDay(role: UserRole, now: Date) {
    return zonedHour(now, this.timeZone) >= CLOSING_HOUR ? this.dayService.forDay(role, undefined, now) : Promise.resolve(null);
  }
}
