import type { PartnerDetails } from '../validators/partnerDetails.js';
import type { TabEntryKind } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CustomerFields, CustomerRecord, PurchaseTotals, TabEntryRecord, TabRepository } from '../repositories/TabRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { placeWords } from '../repositories/MoneyRepository.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { startOfDay, zonedDay } from '../utils/zonedDates.js';
import { assertMonthsOpen } from './vat/periodLock.js';

/** Charges on no invoice (so no promised day) count as late after this long. */
export const OVERDUE_DAYS = 30;

export interface CustomerDto extends PartnerDetails {
  id: number;
  name: string;
  kind: 'person' | 'business';
  /** The business's NUI; null for a person. */
  nui: string | null;
  phone: string | null;
  note: string | null;
  /** The owner lets them take goods and pay later, up to `creditLimit`. */
  payLater: boolean;
  /** They pay the wholesale price instead of the shelf price. */
  paysWholesale: boolean;
  /** The most they may owe on their tab, and their usual discount in percent; null: none. */
  creditLimit: number | null;
  /** The bonus they earn on a year's purchases, in percent; null: none. */
  bonusPercent: number | null;
  discountPercent: number | null;
  /** What they owe now; below zero when they have credit. */
  balance: number;
  /** When the oldest charge still unpaid was made (payments pay off the oldest first); null when nothing is owed. */
  owingSince: string | null;
  lastPaymentAt: string | null;
  /** What is past its promised day, and the earliest such day ("YYYY-MM-DD"); 0 and null when nobody is late. */
  lateAmount: number;
  lateSince: string | null;
  archived: boolean;
  /** Everything they bought (tab or paid at the till), returns taken off. */
  spent: number;
  spentThisYear: number;
  purchases: number;
  lastPurchaseAt: string | null;
}

export interface CustomerDetailDto extends CustomerDto {
  entries: TabEntryDto[];
  /** What is still to pay, invoice by invoice, oldest first; charges on no invoice are one item. */
  openItems: OpenItemDto[];
  topProducts: Array<{ productId: number; name: string; quantity: number; total: number }>;
}

export interface TabEntryDto {
  id: number;
  /** A refund is a return taken off the tab. */
  kind: TabEntryKind;
  amount: number;
  note: string | null;
  saleId: number | null;
  /** The sale (or the refund's return) was undone, so this entry no longer counts. */
  undone: boolean;
  at: string;
  by: string | null;
}

export type CustomerInput = CustomerFields;

/** Something a customer still owes for: an invoice on their account, or the charges on their tab that are on no invoice. */
export interface OpenItemDto {
  /** Null: the tab's charges on no invoice. */
  documentId: number | null;
  number: string | null;
  /** The invoice's day, or the oldest of the charges. */
  date: string;
  dueDate: string | null;
  total: number;
  paid: number;
  left: number;
}

/** A received payment said to be for these items (the rest pays the oldest first). */
export interface Allocation {
  documentId: number | null;
  amount: number;
}

export interface ReceiveInput {
  amount: number;
  note: string | null;
  /** Where the money arrived; the shop's till when left out. */
  placeId?: number | null;
  /** The day it was paid; today when left out. */
  day?: string | null;
  allocations?: Allocation[];
}

/**
 * Each open item, oldest first. Payments said to be for an item pay it first;
 * the rest of every payment and refund pays the oldest items, the way a tab
 * always has.
 */
export function openItemsOf(
  entries: Array<Pick<TabEntryRecord, 'id' | 'kind' | 'amount' | 'sale_id' | 'sale_undone' | 'occurred_at'>>,
  invoiceOf: Map<number, { id: number; number: string; issuedAt: Date; dueDate: string | null }>,
  allocations: Array<{ payment_id: number; document_id: number | null; amount: string }>,
): OpenItemDto[] {
  const items = new Map<string, OpenItemDto>();
  const keyOf = (documentId: number | null) => (documentId === null ? 'tab' : `d${documentId}`);
  for (const entry of entries) {
    if (entry.sale_undone || entry.kind !== 'charge') continue;
    const invoice = entry.sale_id === null ? undefined : invoiceOf.get(entry.sale_id);
    const key = keyOf(invoice?.id ?? null);
    const item = items.get(key) ?? {
      documentId: invoice?.id ?? null,
      number: invoice?.number ?? null,
      date: (invoice?.issuedAt ?? entry.occurred_at).toISOString(),
      dueDate: invoice?.dueDate ?? null,
      total: 0,
      paid: 0,
      left: 0,
    };
    item.total = roundMoney(item.total + Number(entry.amount));
    item.left = item.total;
    items.set(key, item);
  }
  const ordered = [...items.values()].sort((a, b) => a.date.localeCompare(b.date));
  const pay = (item: OpenItemDto, amount: number) => {
    const used = Math.min(amount, item.left);
    item.paid = roundMoney(item.paid + used);
    item.left = roundMoney(item.left - used);
    return roundMoney(amount - used);
  };

  let pool = 0;
  const allocatedByPayment = new Map<number, number>();
  for (const allocation of allocations) {
    const amount = Number(allocation.amount);
    allocatedByPayment.set(allocation.payment_id, roundMoney((allocatedByPayment.get(allocation.payment_id) ?? 0) + amount));
    const item = items.get(keyOf(allocation.document_id));
    // An item that no longer needs it (its sale was undone) gives it to the oldest instead.
    pool = roundMoney(pool + (item ? pay(item, amount) : amount));
  }
  for (const entry of entries) {
    if (entry.sale_undone || entry.kind === 'charge') continue;
    pool = roundMoney(pool + Number(entry.amount) - (entry.kind === 'payment' || entry.kind === 'credit' ? (allocatedByPayment.get(entry.id) ?? 0) : 0));
  }
  for (const item of ordered) {
    if (pool <= 0) break;
    pool = pay(item, pool);
  }
  return ordered.filter((item) => item.left > 0);
}

/**
 * Balance, oldest unpaid charge and last payment from a customer's entries
 * (oldest first). Money paid for a sale that was later undone stays theirs as
 * credit, which pays for their next charges.
 */
function summarise(entries: TabEntryRecord[]) {
  const unpaid: Array<{ at: Date; left: number }> = [];
  let credit = 0;
  let lastPaymentAt: Date | null = null;
  for (const entry of entries) {
    if (entry.sale_undone) continue;
    const amount = Number(entry.amount);
    if (entry.kind === 'charge') {
      const used = Math.min(credit, amount);
      credit = roundMoney(credit - used);
      if (amount > used) unpaid.push({ at: entry.occurred_at, left: roundMoney(amount - used) });
      continue;
    }
    if (entry.kind === 'payment') lastPaymentAt = entry.occurred_at;
    let rest = amount;
    while (rest > 0 && unpaid.length > 0) {
      const oldest = unpaid[0]!;
      const paid = Math.min(rest, oldest.left);
      oldest.left = roundMoney(oldest.left - paid);
      rest = roundMoney(rest - paid);
      if (oldest.left <= 0) unpaid.shift();
    }
    credit = roundMoney(credit + rest);
  }
  const balance = roundMoney(unpaid.reduce((sum, charge) => sum + charge.left, 0) - credit);
  return { balance, owingSince: unpaid[0]?.at ?? null, lastPaymentAt };
}

const NO_PURCHASES: PurchaseTotals = { spent: 0, spentThisYear: 0, purchases: 0, lastPurchaseAt: null };

/** The open items past their promised day: an invoice's due date, or `OVERDUE_DAYS` after a charge on no invoice. */
export function lateOf(items: OpenItemDto[], today: string): { lateAmount: number; lateSince: string | null } {
  let lateAmount = 0;
  let lateSince: string | null = null;
  for (const item of items) {
    const due = item.dueDate ?? addDays(item.date.slice(0, 10), OVERDUE_DAYS);
    if (due >= today) continue;
    lateAmount = roundMoney(lateAmount + item.left);
    if (lateSince === null || due < lateSince) lateSince = due;
  }
  return { lateAmount, lateSince };
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toCustomerDto(
  customer: CustomerRecord,
  entries: TabEntryRecord[],
  bought: PurchaseTotals = NO_PURCHASES,
  late: { lateAmount: number; lateSince: string | null } = { lateAmount: 0, lateSince: null },
): CustomerDto {
  const { balance, owingSince, lastPaymentAt } = summarise(entries);
  return {
    id: customer.id,
    name: customer.name,
    kind: customer.kind,
    nui: customer.nui,
    phone: customer.phone,
    note: customer.note,
    address: customer.address,
    city: customer.city,
    businessNo: customer.businessNo,
    fiscalNo: customer.fiscalNo,
    vatNo: customer.vatNo,
    iban: customer.iban,
    contactPerson: customer.contactPerson,
    mobile: customer.mobile,
    payLater: customer.pay_later,
    paysWholesale: customer.pays_wholesale,
    creditLimit: customer.credit_limit === null ? null : Number(customer.credit_limit),
    discountPercent: customer.discount_percent === null ? null : Number(customer.discount_percent),
    bonusPercent: customer.bonus_percent === null ? null : Number(customer.bonus_percent),
    balance,
    owingSince: owingSince?.toISOString() ?? null,
    lastPaymentAt: lastPaymentAt?.toISOString() ?? null,
    lateAmount: late.lateAmount,
    lateSince: late.lateSince,
    archived: customer.archived_at !== null,
    spent: roundMoney(bought.spent),
    spentThisYear: roundMoney(bought.spentThisYear),
    purchases: bought.purchases,
    lastPurchaseAt: bought.lastPurchaseAt?.toISOString() ?? null,
  };
}

const toEntryDto = (entry: TabEntryRecord): TabEntryDto => ({
  id: entry.id,
  kind: entry.kind,
  amount: Number(entry.amount),
  note: entry.note,
  saleId: entry.sale_id,
  undone: entry.sale_undone,
  at: entry.occurred_at.toISOString(),
  by: entry.created_by_name,
});

/**
 * Customer tabs: regulars who take things now and pay later. Sales are put on
 * a tab when they're recorded; payments pay off the oldest charges first.
 */
export class TabService {
  constructor(
    private readonly tabRepository: TabRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  /** The first moment of this calendar year in the shop's time zone. */
  private yearStart(now = new Date()): Date {
    return startOfDay(`${zonedDay(now, this.timeZone).slice(0, 4)}-01-01`, this.timeZone);
  }

  /** Everyone with a tab, most owed first, then by name. */
  async list(now = new Date()): Promise<CustomerDto[]> {
    const customers = await this.tabRepository.findCustomers();
    const ids = customers.map((customer) => customer.id);
    const [entries, bought, invoices, allocations] = await Promise.all([
      this.tabRepository.findEntries(ids),
      this.tabRepository.purchaseTotals(this.yearStart(), ids),
      this.tabRepository.chargeInvoices(ids),
      this.tabRepository.allocations(ids),
    ]);
    const today = zonedDay(now, this.timeZone);
    return customers
      .map((customer) => {
        const own = entries.filter((entry) => entry.customer_id === customer.id);
        const items = openItemsOf(own, invoices, allocations.filter((allocation) => allocation.customer_id === customer.id));
        return toCustomerDto(customer, own, bought.get(customer.id), lateOf(items, today));
      })
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }

  async detail(id: number): Promise<CustomerDetailDto> {
    const customer = await this.tabRepository.findCustomer(id);
    if (!customer) throw new NotFoundError(`Customer ${id} does not exist`);
    const [entries, bought, topProducts, invoices, allocations] = await Promise.all([
      this.tabRepository.findEntries([id]),
      this.tabRepository.purchaseTotals(this.yearStart(), [id]),
      this.tabRepository.topProducts(id),
      this.tabRepository.chargeInvoices([id]),
      this.tabRepository.allocations([id]),
    ]);
    const openItems = openItemsOf(entries, invoices, allocations);
    return {
      ...toCustomerDto(customer, entries, bought.get(id), lateOf(openItems, zonedDay(new Date(), this.timeZone))),
      entries: [...entries].reverse().map(toEntryDto),
      openItems,
      topProducts,
    };
  }

  /** Every customer's open items, for matching a bank statement's lines. */
  async allOpenItems(): Promise<Array<OpenItemDto & { customerId: number; customerName: string }>> {
    const customers = await this.tabRepository.findCustomers(true);
    const ids = customers.map((customer) => customer.id);
    const [entries, invoices, allocations] = await Promise.all([
      this.tabRepository.findEntries(ids),
      this.tabRepository.chargeInvoices(ids),
      this.tabRepository.allocations(ids),
    ]);
    return customers.flatMap((customer) =>
      openItemsOf(
        entries.filter((entry) => entry.customer_id === customer.id),
        invoices,
        allocations.filter((allocation) => allocation.customer_id === customer.id),
      ).map((item) => ({ ...item, customerId: customer.id, customerName: customer.name })),
    );
  }

  async create(input: CustomerInput, actorId: number): Promise<CustomerDto> {
    const id = await this.transactions.run(async (repos) => {
      const customerId = await repos.tabs.createCustomer({ ...input, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'customer.created',
        entityType: 'customer',
        entityId: customerId,
        say: { key: 'tabOpened', params: { name: input.name } },
        details: { ...input },
      });
      return customerId;
    });
    return this.detail(id);
  }

  async update(id: number, input: CustomerInput, actorId: number, logExtra?: Record<string, unknown>): Promise<CustomerDto> {
    const before = await this.tabRepository.findCustomer(id);
    if (!before) throw new NotFoundError(`Customer ${id} does not exist`);
    await this.transactions.run(async (repos) => {
      await repos.tabs.updateCustomer(id, input);
      await repos.activityLog.create({
        userId: actorId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: id,
        say: { key: 'customerChanged', params: { name: before.name } },
        details: { before: { name: before.name, kind: before.kind, nui: before.nui, phone: before.phone, note: before.note }, after: input, ...logExtra },
      });
    });
    return this.detail(id);
  }

  /** Closes a settled tab; one with money still owed, or credit left, stays open. */
  async archive(id: number, actorId: number, now = new Date()): Promise<void> {
    const customer = await this.tabRepository.findCustomer(id);
    if (!customer) throw new NotFoundError(`Customer ${id} does not exist`);
    if (customer.archived_at) throw new ConflictError('This tab is already closed');
    const balance = await this.tabRepository.balance(id);
    if (balance > 0) throw new ConflictError(`${customer.name} still owes ${formatEuro(balance)}. Take the payment first.`);
    if (balance < 0) {
      throw new ConflictError(`${customer.name} has ${formatEuro(-balance)} credit left. It pays for their next purchase on the tab.`);
    }
    await this.transactions.run(async (repos) => {
      await repos.tabs.archiveCustomer(id, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'customer.archived',
        entityType: 'customer',
        entityId: id,
        say: { key: 'tabClosed', params: { name: customer.name } },
        details: null,
      });
    });
  }

  /**
   * Money in against the tab: at the till, or into a bank or the safe. Never
   * more than they owe; credit only comes from undone sales. It can be said to
   * be for some invoices (the rest pays the oldest first).
   */
  async pay(customerId: number, input: ReceiveInput, actorId: number, now = new Date()): Promise<CustomerDetailDto> {
    await this.transactions.run((repos) => receivePayment(repos, customerId, input, actorId, this.timeZone, now));
    return this.detail(customerId);
  }

  /** Customers with something past the day they promised to pay, the longest late first. */
  async overdue(now = new Date()): Promise<CustomerDto[]> {
    return (await this.list(now)).filter((customer) => customer.lateAmount > 0).sort((a, b) => a.lateSince!.localeCompare(b.lateSince!));
  }
}

/** A day's payment that isn't today's goes in at noon, so it stays on that day in every time zone near the shop's. */
function momentOf(day: string | null | undefined, timeZone: string, now: Date): Date {
  if (!day || day === zonedDay(now, timeZone)) return now;
  return new Date(startOfDay(day, timeZone).getTime() + 12 * 60 * 60 * 1000);
}

/** Record money received from a customer, inside a transaction. Returns the payment's tab entry id. */
export async function receivePayment(
  repos: TransactionalRepositories,
  customerId: number,
  input: ReceiveInput,
  actorId: number,
  timeZone: string,
  now: Date,
): Promise<number> {
  const today = zonedDay(now, timeZone);
  const day = input.day ?? today;
  if (day > today) throw new ValidationError("A payment can't be dated in the future");
  await assertMonthsOpen(repos.periods, [day]);
  const customer = await repos.tabs.findCustomer(customerId);
  if (!customer) throw new NotFoundError(`Customer ${customerId} does not exist`);
  const balance = await repos.tabs.balance(customerId);
  if (input.amount > balance) {
    throw new ValidationError(balance <= 0 ? `${customer.name} doesn't owe anything` : `${customer.name} only owes ${formatEuro(balance)}`);
  }
  const allocations = (input.allocations ?? []).filter((allocation) => allocation.amount > 0);
  if (allocations.length > 0) {
    const total = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    if (total !== roundMoney(input.amount)) throw new ValidationError(`The ticked items add up to ${formatEuro(total)}, not ${formatEuro(input.amount)}`);
    const [entries, invoices, earlier] = await Promise.all([repos.tabs.findEntries([customerId]), repos.tabs.chargeInvoices([customerId]), repos.tabs.allocations([customerId])]);
    const open = openItemsOf(entries, invoices, earlier);
    for (const allocation of allocations) {
      const item = open.find((candidate) => candidate.documentId === allocation.documentId);
      if (!item) throw new ValidationError(allocation.documentId === null ? 'Nothing on the tab is left to pay' : 'That invoice is already paid');
      if (allocation.amount > item.left) throw new ValidationError(`Only ${formatEuro(item.left)} is left on ${item.number ?? 'the tab'}`);
    }
  }
  const place = await repos.money.payFrom({ placeId: input.placeId ?? null, method: 'drawer' });
  const placeRecord = await repos.money.placeOrThrow(place.placeId);
  const paymentId = await repos.tabs.addEntry({
    customerId,
    kind: 'payment',
    amount: input.amount,
    note: input.note,
    saleId: null,
    createdBy: actorId,
    occurredAt: momentOf(day, timeZone, now),
    placeId: place.placeId,
  });
  await repos.money.addAllocations(paymentId, allocations);
  await repos.activityLog.create({
    userId: actorId,
    action: 'tab.paid',
    entityType: 'customer',
    entityId: customerId,
    say: { key: 'tabPaid', params: { name: customer.name, amount: input.amount, place: placeWords(placeRecord) } },
    details: { amount: input.amount, before: balance, placeId: place.placeId, day, allocations },
  });
  return paymentId;
}
