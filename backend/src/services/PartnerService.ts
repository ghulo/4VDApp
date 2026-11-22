import { AiUnavailableError, ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { AddressFields, AddressRecord, PartnerMatch, PartnerRepository, PartnerSide } from '../repositories/PartnerRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { PartnerReader, PartnerReading } from './ai/partnerReader.js';
import type { SupplierBillService } from './SupplierBillService.js';
import { openItemsOf } from './TabService.js';
import { assertMonthsOpen } from './vat/periodLock.js';

export interface AddressDto {
  id: number;
  label: string;
  address: string;
  city: string | null;
  note: string | null;
}

/** A firm on both lists: what it owes the shop as a customer and what the shop owes it as a supplier. */
export interface PartnerLinkDto {
  customer: { id: number; name: string } | null;
  supplier: { id: number; name: string } | null;
  /** What they owe on their tab. */
  owesYou: number;
  /** What is left on their bills. */
  youOwe: number;
  /** What an offset would clear now: the smaller of the two. */
  canOffset: number;
  offsets: Array<{ id: number; amount: number; day: string; note: string | null; by: string | null }>;
}

export interface BonusDto {
  percent: number | null;
  years: Array<{ year: number; bought: number; earned: number; paid: { amount: number; day: string } | null; canPay: boolean }>;
}

interface Actor {
  id: number;
}

const toAddress = (row: AddressRecord): AddressDto => ({ id: row.id, label: row.label, address: row.address, city: row.city, note: row.note });

/** Bills from a supplier that are still open, oldest due first: what an offset pays. */
type Due = { id: number; dueOn: string | null; issuedOn: string };
const byDue = (a: Due, b: Due) => (a.dueOn ?? a.issuedOn).localeCompare(b.dueOn ?? b.issuedOn) || a.issuedOn.localeCompare(b.issuedOn) || a.id - b.id;

/**
 * Customers and suppliers as one partner: filling a new firm in fast (from what
 * 4VD already has, a photo or pasted text), extra addresses, setting off what
 * a firm on both lists owes against what it is owed, and a customer's bonus.
 */
export class PartnerService {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly bills: SupplierBillService,
    private readonly transactions: TransactionManager,
    private readonly reader: PartnerReader | null,
    private readonly timeZone: string,
  ) {}

  lookup(input: { nui?: string; q?: string }): Promise<PartnerMatch[]> {
    return this.partners.lookup(input);
  }

  async read(source: { pages?: Array<{ mime: string; data: string }>; text?: string; side: PartnerSide }): Promise<PartnerReading> {
    if (!this.reader) throw new AiUnavailableError('Reading needs the AI service, which isn’t set up on this server. Type the details in.');
    if (!source.pages?.length && !source.text?.trim()) throw new ValidationError('Add a photo, or paste the text');
    const reading = await this.reader.read({
      side: source.side,
      text: source.text?.trim() || undefined,
      pages: source.pages?.map((page) => ({ mime: page.mime, bytes: Buffer.from(page.data, 'base64') })),
    });
    const digits = (value: string) => value.replace(/\D/g, '');
    return {
      ...reading,
      nui: digits(reading.nui),
      fiscalNo: digits(reading.fiscalNo),
      vatNo: digits(reading.vatNo),
      businessNo: digits(reading.businessNo),
      iban: reading.iban.replace(/\s/g, '').toUpperCase(),
    };
  }

  // ---- Addresses ----

  async addresses(owner: { customerId?: number; supplierId?: number }): Promise<AddressDto[]> {
    return (await this.partners.addresses(owner)).map(toAddress);
  }

  async addAddress(owner: { customerId?: number; supplierId?: number }, fields: AddressFields, userId: number): Promise<AddressDto> {
    const id = await this.transactions.run(async (repos) => {
      const customerId = owner.customerId ?? null;
      const supplierId = owner.supplierId ?? null;
      if (customerId !== null && !(await repos.partners.customer(customerId))) throw new NotFoundError(`Customer ${customerId} does not exist`);
      if (supplierId !== null && !(await repos.partners.supplier(supplierId))) throw new NotFoundError(`Supplier ${supplierId} does not exist`);
      const added = await repos.partners.addAddress({ customerId, supplierId }, fields);
      await logAddress(repos, userId, { customer_id: customerId, supplier_id: supplierId, label: fields.label }, 'added');
      return added;
    });
    return toAddress((await this.partners.findAddress(id))!);
  }

  async updateAddress(id: number, fields: AddressFields, userId: number): Promise<AddressDto> {
    await this.transactions.run(async (repos) => {
      const address = await repos.partners.findAddress(id);
      if (!address) throw new NotFoundError(`Address ${id} does not exist`);
      await repos.partners.updateAddress(id, fields);
      await logAddress(repos, userId, { ...address, label: fields.label }, 'changed');
    });
    return toAddress((await this.partners.findAddress(id))!);
  }

  async removeAddress(id: number, userId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      const address = await repos.partners.findAddress(id);
      if (!address) throw new NotFoundError(`Address ${id} does not exist`);
      await repos.partners.removeAddress(id);
      await logAddress(repos, userId, address, 'removed');
    });
  }

  // ---- One firm on both lists ----

  /** The link from either side: a customer's supplier, or a supplier's customer, joined by their NUI. */
  async link(from: { customerId?: number; supplierId?: number }): Promise<PartnerLinkDto> {
    let customer: { id: number; name: string } | null = null;
    let supplier: { id: number; name: string } | null = null;
    if (from.customerId !== undefined) {
      const row = await this.partners.customer(from.customerId);
      if (!row) throw new NotFoundError(`Customer ${from.customerId} does not exist`);
      customer = { id: row.id, name: row.name };
      supplier = (await this.partners.otherSide('customer', row.nui)) ?? null;
    } else {
      const row = await this.partners.supplier(from.supplierId ?? 0);
      if (!row) throw new NotFoundError(`Supplier ${from.supplierId} does not exist`);
      supplier = { id: row.id, name: row.name };
      customer = (await this.partners.otherSide('supplier', row.nui)) ?? null;
    }
    const owesYou = customer ? await this.transactions.run((repos) => repos.tabs.balance(customer!.id)) : 0;
    const youOwe = supplier ? roundMoney((await this.openBills(supplier.id)).reduce((sum, bill) => sum + bill.left, 0)) : 0;
    const offsets = customer ? await this.partners.offsets(customer.id) : [];
    return {
      customer,
      supplier,
      owesYou: roundMoney(owesYou),
      youOwe,
      canOffset: customer && supplier ? roundMoney(Math.max(0, Math.min(owesYou, youOwe))) : 0,
      offsets: offsets.map((offset) => ({ id: offset.id, amount: Number(offset.amount), day: offset.day, note: offset.note, by: offset.by })),
    };
  }

  private async openBills(supplierId: number) {
    return (await this.bills.list({ supplierId, status: 'open' })).filter((bill) => bill.kind !== 'credit' && bill.left > 0).sort(byDue);
  }

  /**
   * Kompensim: what the firm owes on its tab cancels what the shop owes on its
   * bills, oldest first on both sides. No money moves, so tills and cash counts
   * don't see it; the books move it from receivables to payables.
   */
  async offset(customerId: number, input: { amount?: number | null; note: string | null }, actor: Actor, now = new Date()): Promise<PartnerLinkDto> {
    const link = await this.link({ customerId });
    if (!link.supplier) throw new ValidationError(`${link.customer!.name} isn't on the suppliers list with the same NUI`);
    const amount = roundMoney(input.amount ?? link.canOffset);
    if (amount <= 0) throw new ValidationError(link.owesYou <= 0 ? `${link.customer!.name} owes nothing on their tab` : 'Nothing is owed on their bills');
    if (amount > link.canOffset) throw new ValidationError(`At most ${formatEuro(link.canOffset)} can be set off: the smaller of what each side owes`);
    const day = zonedDay(now, this.timeZone);
    const bills = await this.openBills(link.supplier.id);
    const supplier = link.supplier;
    const customer = link.customer!;

    await this.transactions.run(async (repos) => {
      await assertMonthsOpen(repos.periods, [day]);
      for (const bill of bills) await repos.bills.lock(bill.id);
      // The tab may have changed since it was read: check again inside the lock.
      if (amount > (await repos.tabs.balance(customer.id)) + 0.001) throw new ConflictError('Their tab changed just now. Open it again.');
      const offsetId = await repos.partners.addOffset({ customerId: customer.id, supplierId: supplier.id, amount, day, note: input.note, createdBy: actor.id });

      // The customer's side: a credit on the tab, against their oldest open items.
      const [entries, invoices, earlier] = await Promise.all([repos.tabs.findEntries([customer.id]), repos.tabs.chargeInvoices([customer.id]), repos.tabs.allocations([customer.id])]);
      let left = amount;
      const allocations: Array<{ documentId: number | null; amount: number }> = [];
      for (const item of openItemsOf(entries, invoices, earlier)) {
        if (left <= 0) break;
        const part = roundMoney(Math.min(left, item.left));
        if (part > 0) allocations.push({ documentId: item.documentId, amount: part });
        left = roundMoney(left - part);
      }
      const note = `Kompensim · ${supplier.name}`;
      const entryId = await repos.tabs.addEntry({ customerId: customer.id, kind: 'credit', amount, note, saleId: null, createdBy: actor.id, occurredAt: now });
      await repos.partners.setCreditFrom(entryId, { offsetId });
      await repos.money.addAllocations(entryId, allocations);

      // The supplier's side: their oldest bills, paid by the offset.
      let rest = amount;
      for (const bill of bills) {
        if (rest <= 0) break;
        const part = roundMoney(Math.min(rest, bill.left));
        const paymentId = await repos.bills.addPayment({ billId: bill.id, amount: part, paidOn: day, method: 'offset', placeId: null, note: `Kompensim · ${customer.name}`, createdBy: actor.id });
        await repos.partners.setPaymentOffset(paymentId, offsetId);
        rest = roundMoney(rest - part);
      }

      await repos.activityLog.create({
        userId: actor.id,
        action: 'partner.offset',
        entityType: 'customer',
        entityId: customer.id,
        say: { key: 'partnerOffset', params: { name: customer.name, amount } },
        details: { offsetId, supplierId: supplier.id, amount, allocations },
      });
    });
    return this.link({ customerId });
  }

  // ---- Bonus ----

  /** The bonus earned this year and last, and what was paid out. */
  async bonus(customerId: number, now = new Date()): Promise<BonusDto> {
    const customer = await this.partners.customer(customerId);
    if (!customer) throw new NotFoundError(`Customer ${customerId} does not exist`);
    const percent = customer.bonus_percent === null ? null : Number(customer.bonus_percent);
    const [bought, payouts] = await Promise.all([this.partners.boughtByYear(customerId, this.timeZone), this.partners.bonusPayouts(customerId)]);
    const thisYear = Number(zonedDay(now, this.timeZone).slice(0, 4));
    const years = new Set<number>([thisYear, thisYear - 1, ...payouts.map((payout) => payout.year)]);
    return {
      percent,
      years: [...years]
        .sort((a, b) => b - a)
        .map((year) => {
          const paid = payouts.find((payout) => payout.year === year);
          const yearBought = roundMoney(Math.max(0, bought.get(year) ?? 0));
          const earned = paid ? Number(paid.amount) : roundMoney(((percent ?? 0) * yearBought) / 100);
          return {
            year,
            bought: paid ? Number(paid.bought) : yearBought,
            earned,
            paid: paid ? { amount: Number(paid.amount), day: paid.day } : null,
            canPay: !paid && earned > 0,
          };
        }),
    };
  }

  /**
   * Pay a year's bonus as a credit on their tab. Usually after the year ends;
   * paying earlier closes that year at what it has earned so far.
   */
  async payBonus(customerId: number, year: number, actor: Actor, now = new Date()): Promise<BonusDto> {
    const current = await this.bonus(customerId, now);
    const row = current.years.find((one) => one.year === year);
    if (!row) throw new ValidationError(`No bonus to pay for ${year}`);
    if (row.paid) throw new ConflictError(`The ${year} bonus was paid already`);
    if (!row.canPay || current.percent === null) throw new ValidationError(`Nothing was earned in ${year}`);
    const day = zonedDay(now, this.timeZone);
    const customer = (await this.partners.customer(customerId))!;

    await this.transactions.run(async (repos) => {
      await assertMonthsOpen(repos.periods, [day]);
      const bonusId = await repos.partners.addBonusPayout({ customerId, year, bought: row.bought, percent: current.percent!, amount: row.earned, day, createdBy: actor.id });
      if (bonusId === 0) throw new ConflictError(`The ${year} bonus was paid already`);
      const [entries, invoices, earlier] = await Promise.all([repos.tabs.findEntries([customerId]), repos.tabs.chargeInvoices([customerId]), repos.tabs.allocations([customerId])]);
      let left = row.earned;
      const allocations: Array<{ documentId: number | null; amount: number }> = [];
      for (const item of openItemsOf(entries, invoices, earlier)) {
        if (left <= 0) break;
        const part = roundMoney(Math.min(left, item.left));
        if (part > 0) allocations.push({ documentId: item.documentId, amount: part });
        left = roundMoney(left - part);
      }
      const entryId = await repos.tabs.addEntry({ customerId, kind: 'credit', amount: row.earned, note: `Bonus ${year}`, saleId: null, createdBy: actor.id, occurredAt: now });
      await repos.partners.setCreditFrom(entryId, { bonusId });
      await repos.money.addAllocations(entryId, allocations);
      await repos.activityLog.create({
        userId: actor.id,
        action: 'customer.bonus_paid',
        entityType: 'customer',
        entityId: customerId,
        say: { key: 'bonusPaid', params: { name: customer.name, amount: row.earned, year } },
        details: { bonusId, year, bought: row.bought, percent: current.percent, amount: row.earned },
      });
    });
    return this.bonus(customerId, now);
  }
}

/** A customer's or supplier's address added, changed or removed, in History under them. Throws when the customer or supplier is gone. */
async function logAddress(
  repos: TransactionalRepositories,
  userId: number,
  address: { customer_id: number | null; supplier_id: number | null; label: string },
  change: 'added' | 'changed' | 'removed',
): Promise<void> {
  if (address.customer_id !== null) {
    const customer = await repos.partners.customer(address.customer_id);
    if (!customer) throw new NotFoundError(`Customer ${address.customer_id} does not exist`);
    await repos.activityLog.create({ userId, action: 'customer.address_changed', entityType: 'customer', entityId: customer.id, say: { key: 'addressChanged', params: { name: customer.name, change, label: address.label } } });
  } else if (address.supplier_id !== null) {
    const supplier = await repos.partners.supplier(address.supplier_id);
    if (!supplier) throw new NotFoundError(`Supplier ${address.supplier_id} does not exist`);
    await repos.activityLog.create({ userId, action: 'supplier.address_changed', entityType: 'supplier', entityId: supplier.id, say: { key: 'addressChanged', params: { name: supplier.name, change, label: address.label } } });
  }
}
