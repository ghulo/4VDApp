import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CustomerRecord, TabEntryRecord, TabRepository } from '../repositories/TabRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';

/** A tab unpaid this long shows up in "Needs your attention". */
export const OVERDUE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CustomerDto {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  /** What they owe now. */
  balance: number;
  /** When the oldest charge still unpaid was made (payments pay off the oldest first); null when nothing is owed. */
  owingSince: string | null;
  lastPaymentAt: string | null;
  archived: boolean;
}

export interface TabEntryDto {
  id: number;
  kind: 'charge' | 'payment';
  amount: number;
  note: string | null;
  saleId: number | null;
  /** The sale was undone, so this charge no longer counts. */
  undone: boolean;
  at: string;
  by: string | null;
}

export interface CustomerInput {
  name: string;
  phone: string | null;
  note: string | null;
}

/** Balance, oldest unpaid charge and last payment from a customer's entries (oldest first). */
function summarise(entries: TabEntryRecord[]) {
  const unpaid: Array<{ at: Date; left: number }> = [];
  let lastPaymentAt: Date | null = null;
  for (const entry of entries) {
    if (entry.sale_undone) continue;
    const amount = Number(entry.amount);
    if (entry.kind === 'charge') {
      unpaid.push({ at: entry.occurred_at, left: amount });
      continue;
    }
    lastPaymentAt = entry.occurred_at;
    let rest = amount;
    while (rest > 0 && unpaid.length > 0) {
      const oldest = unpaid[0]!;
      const paid = Math.min(rest, oldest.left);
      oldest.left = roundMoney(oldest.left - paid);
      rest = roundMoney(rest - paid);
      if (oldest.left <= 0) unpaid.shift();
    }
  }
  const balance = roundMoney(unpaid.reduce((sum, charge) => sum + charge.left, 0));
  return { balance, owingSince: unpaid[0]?.at ?? null, lastPaymentAt };
}

function toCustomerDto(customer: CustomerRecord, entries: TabEntryRecord[]): CustomerDto {
  const { balance, owingSince, lastPaymentAt } = summarise(entries);
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    note: customer.note,
    balance,
    owingSince: owingSince?.toISOString() ?? null,
    lastPaymentAt: lastPaymentAt?.toISOString() ?? null,
    archived: customer.archived_at !== null,
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
  ) {}

  /** Everyone with a tab, most owed first, then by name. */
  async list(): Promise<CustomerDto[]> {
    const customers = await this.tabRepository.findCustomers();
    const entries = await this.tabRepository.findEntries(customers.map((customer) => customer.id));
    return customers
      .map((customer) => toCustomerDto(customer, entries.filter((entry) => entry.customer_id === customer.id)))
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }

  async detail(id: number): Promise<CustomerDto & { entries: TabEntryDto[] }> {
    const customer = await this.tabRepository.findCustomer(id);
    if (!customer) throw new NotFoundError(`Customer ${id} does not exist`);
    const entries = await this.tabRepository.findEntries([id]);
    return { ...toCustomerDto(customer, entries), entries: [...entries].reverse().map(toEntryDto) };
  }

  async create(input: CustomerInput, actorId: number): Promise<CustomerDto> {
    const id = await this.transactions.run(async (repos) => {
      const customerId = await repos.tabs.createCustomer({ ...input, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'customer.created',
        entityType: 'customer',
        entityId: customerId,
        summary: `Opened a tab for ${input.name}`,
        details: { ...input },
      });
      return customerId;
    });
    return this.detail(id);
  }

  async update(id: number, input: CustomerInput, actorId: number): Promise<CustomerDto> {
    const before = await this.tabRepository.findCustomer(id);
    if (!before) throw new NotFoundError(`Customer ${id} does not exist`);
    await this.transactions.run(async (repos) => {
      await repos.tabs.updateCustomer(id, input);
      await repos.activityLog.create({
        userId: actorId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: id,
        summary: `Changed ${before.name}'s details`,
        details: { before: { name: before.name, phone: before.phone, note: before.note }, after: input },
      });
    });
    return this.detail(id);
  }

  /** Closes a settled tab; one with money still owed stays open. */
  async archive(id: number, actorId: number, now = new Date()): Promise<void> {
    const customer = await this.tabRepository.findCustomer(id);
    if (!customer) throw new NotFoundError(`Customer ${id} does not exist`);
    if (customer.archived_at) throw new ConflictError('This tab is already closed');
    const balance = await this.tabRepository.balance(id);
    if (balance > 0) throw new ConflictError(`${customer.name} still owes ${formatEuro(balance)}. Take the payment first.`);
    await this.transactions.run(async (repos) => {
      await repos.tabs.archiveCustomer(id, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'customer.archived',
        entityType: 'customer',
        entityId: id,
        summary: `Closed ${customer.name}'s tab`,
        details: null,
      });
    });
  }

  /** Money in against the tab. Never more than they owe, so a tab can't go into credit. */
  async pay(customerId: number, input: { amount: number; note: string | null }, actorId: number): Promise<CustomerDto> {
    await this.transactions.run(async (repos) => {
      const customer = await repos.tabs.findCustomer(customerId);
      if (!customer) throw new NotFoundError(`Customer ${customerId} does not exist`);
      const balance = await repos.tabs.balance(customerId);
      if (input.amount > balance) {
        throw new ValidationError(
          balance === 0 ? `${customer.name} doesn't owe anything` : `${customer.name} only owes ${formatEuro(balance)}`,
        );
      }
      await repos.tabs.addEntry({ customerId, kind: 'payment', amount: input.amount, note: input.note, saleId: null, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'tab.paid',
        entityType: 'customer',
        entityId: customerId,
        summary: `${customer.name} paid ${formatEuro(input.amount)} off their tab`,
        details: { amount: input.amount, before: balance },
      });
    });
    return this.detail(customerId);
  }

  /** Tabs with a charge unpaid for `OVERDUE_DAYS` or more, oldest first. */
  async overdue(now = new Date()): Promise<CustomerDto[]> {
    const cutoff = now.getTime() - OVERDUE_DAYS * MS_PER_DAY;
    return (await this.list())
      .filter((customer) => customer.owingSince !== null && new Date(customer.owingSince).getTime() <= cutoff)
      .sort((a, b) => a.owingSince!.localeCompare(b.owingSince!));
  }
}
