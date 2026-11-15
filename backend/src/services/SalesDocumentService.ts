import type { DeliveryStatus, OfferStatus } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { DeliveryRecord, OfferLineRecord, OfferRecord, SalesDocumentRepository } from '../repositories/SalesDocumentRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { toOffset, toPaginationMeta } from '../utils/pagination.js';
import { addDays, zonedDateTime, zonedDay } from '../utils/zonedDates.js';
import { calculateUnitPrice } from './pricing/bulkPricing.js';
import { levelPrice } from './pricing/salePrice.js';
import { receivePayment } from './TabService.js';
import { formatNumber, readRules } from './shopRules.js';

/** How long an offer stands when no day is given. */
export const OFFER_VALID_DAYS = 14;
/** Delivered ones stay on the list this long, so the day's work can be looked back on. */
const DELIVERED_SHOWN_DAYS = 2;

export interface OfferDto {
  id: number;
  number: string;
  /** When it was made. */
  at: string;
  validUntil: string;
  status: OfferStatus;
  /** Still open, but past its day. */
  expired: boolean;
  customer: { id: number; name: string } | null;
  /** Who it is for: the customer's name, or the name typed for someone not on the list. */
  name: string;
  phone: string | null;
  note: string | null;
  total: number;
  lineCount: number;
  /** The invoice its yes became. */
  sale: { id: number; number: string } | null;
  by: string | null;
}

export interface OfferDetailDto extends OfferDto {
  lines: Array<{ productId: number; productName: string; quantity: number; unitPrice: number; shelfPrice: number; total: number }>;
  /** What the offer saves against the shelf prices. */
  saving: number;
}

export interface NewOfferInput {
  customerId: number | null;
  partyName: string | null;
  partyPhone: string | null;
  note: string | null;
  validUntil: string | null;
  lines: Array<{ productId: number; quantity: number; unitPrice: number }>;
}

export interface DeliveryDto {
  id: number;
  invoice: { id: number; number: string };
  customerId: number | null;
  name: string;
  phone: string | null;
  address: string;
  day: string;
  timeFrom: string | null;
  timeTo: string | null;
  note: string | null;
  total: number;
  /** Still to be paid at the door. */
  toCollect: number;
  status: DeliveryStatus;
  /** Not delivered and its day (or window) has passed. */
  late: boolean;
  takenBy: { id: number; name: string } | null;
  deliveredBy: string | null;
  deliveredAt: string | null;
  collected: number | null;
  lastFailure: string | null;
  failures: number;
  lines: Array<{ productName: string; quantity: number }>;
}

function offerDto(row: OfferRecord, today: string): OfferDto {
  return {
    id: row.id,
    number: row.number,
    at: row.created_at.toISOString(),
    validUntil: row.valid_until,
    status: row.status,
    expired: row.status === 'open' && row.valid_until < today,
    customer: row.customer_id !== null && row.customer_name !== null ? { id: row.customer_id, name: row.customer_name } : null,
    name: row.customer_name ?? row.party_name ?? '',
    phone: row.customer_phone ?? row.party_phone,
    note: row.note,
    total: roundMoney(Number(row.total)),
    lineCount: row.line_count,
    sale: row.sale_document_id !== null && row.sale_number !== null ? { id: row.sale_document_id, number: row.sale_number } : null,
    by: row.created_by_name,
  };
}

const lineDto = (line: OfferLineRecord) => ({
  productId: line.product_id,
  productName: line.product_name,
  quantity: line.quantity,
  unitPrice: roundMoney(Number(line.unit_price)),
  shelfPrice: roundMoney(Number(line.shelf_price)),
  total: roundMoney(Number(line.total)),
});

/**
 * Step 8's sales documents: offers made in a minute and turned into a sale
 * with one tap (at the Counter), and sales taken to the customer's door.
 */
export class SalesDocumentService {
  constructor(
    private readonly repository: SalesDocumentRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  private today(now = new Date()): string {
    return zonedDay(now, this.timeZone);
  }

  // ---- Offers ----

  async listOffers(query: { search?: string; status?: OfferStatus; page: number; limit: number }) {
    const { rows, total } = await this.repository.findOffers({ search: query.search, status: query.status, limit: query.limit, offset: toOffset(query) });
    const today = this.today();
    return { items: rows.map((row) => offerDto(row, today)), meta: toPaginationMeta(query, total) };
  }

  async offer(id: number): Promise<OfferDetailDto> {
    const row = await this.repository.findOffer(id);
    if (!row) throw new NotFoundError(`Offer ${id} does not exist`);
    const lines = (await this.repository.offerLines(id)).map(lineDto);
    const saving = roundMoney(lines.reduce((sum, line) => sum + Math.max(0, line.shelfPrice - line.unitPrice) * line.quantity, 0));
    return { ...offerDto(row, this.today()), lines, saving };
  }

  /** An offer for a customer on the list, or for a typed name; each product once, at the price agreed. */
  async createOffer(input: NewOfferInput, actorId: number, now = new Date()): Promise<OfferDetailDto> {
    if (input.customerId === null && !input.partyName) throw new ValidationError('Pick a customer or type who it is for');
    const today = this.today(now);
    const validUntil = input.validUntil ?? addDays(today, OFFER_VALID_DAYS);
    if (validUntil < today) throw new ValidationError('An offer can’t run out before today');
    const ids = input.lines.map((line) => line.productId);
    if (new Set(ids).size !== ids.length) throw new ValidationError('Each product once: change its quantity instead');
    const id = await this.transactions.run(async (repos) => {
      let name = input.partyName ?? '';
      let wholesale = false;
      if (input.customerId !== null) {
        const customer = await repos.tabs.findCustomer(input.customerId);
        if (!customer || customer.archived_at) throw new NotFoundError(`Customer ${input.customerId} does not exist or their tab is closed`);
        name = customer.name;
        wholesale = customer.pays_wholesale;
      }
      const tiers = await repos.pricingTiers.findByProductIds(ids);
      const lines = [];
      for (const line of input.lines) {
        const product = await repos.products.findById(line.productId, false);
        if (!product) throw new NotFoundError(`Product ${line.productId} does not exist or is hidden`);
        // What this customer would pay without the offer: their price level and the bulk price.
        const shelfPrice = Math.min(
          levelPrice(Number(product.base_price), product.wholesale_price === null ? null : Number(product.wholesale_price), wholesale),
          calculateUnitPrice(Number(product.base_price), tiers.get(product.id) ?? [], line.quantity),
        );
        lines.push({
          productId: product.id,
          productName: product.name,
          quantity: line.quantity,
          unitPrice: roundMoney(line.unitPrice),
          shelfPrice: roundMoney(shelfPrice),
          total: roundMoney(line.unitPrice * line.quantity),
        });
      }
      const total = roundMoney(lines.reduce((sum, line) => sum + line.total, 0));
      const year = Number(today.slice(0, 4));
      const number = formatNumber((await readRules(repos.settings)).numbering.offer, year, await repos.documents.nextNumber('offer', year));
      const offerId = await repos.salesDocs.createOffer({
        number,
        customerId: input.customerId,
        partyName: input.customerId === null ? input.partyName : null,
        partyPhone: input.customerId === null ? input.partyPhone : null,
        note: input.note,
        validUntil,
        total,
        createdBy: actorId,
        lines,
      });
      await repos.activityLog.create({
        userId: actorId,
        action: 'offer.made',
        entityType: 'offer',
        entityId: offerId,
        say: { key: 'offerMade', params: { number, name, total } },
        details: { customerId: input.customerId, total, lines: lines.length },
      });
      return offerId;
    });
    return this.offer(id);
  }

  async declineOffer(id: number, actorId: number): Promise<OfferDetailDto> {
    const offer = await this.offer(id);
    await this.transactions.run(async (repos) => {
      if (!(await repos.salesDocs.decideOffer(id, 'declined', null))) throw new ConflictError(`Offer ${offer.number} was decided already`);
      await repos.activityLog.create({
        userId: actorId,
        action: 'offer.declined',
        entityType: 'offer',
        entityId: id,
        say: { key: 'offerDeclined', params: { number: offer.number, name: offer.name } },
      });
    });
    return this.offer(id);
  }

  // ---- Deliveries ----

  private deliveryDto(row: DeliveryRecord, lines: Array<{ document_id: number; product_name: string; quantity: number }>, now: Date): DeliveryDto {
    const today = this.today(now);
    const clock = zonedDateTime(now, this.timeZone).slice(11);
    const late = row.status !== 'delivered' && (row.deliver_on < today || (row.deliver_on === today && row.time_to !== null && row.time_to < clock));
    return {
      id: row.id,
      invoice: { id: row.document_id, number: row.document_number },
      customerId: row.customer_id,
      name: row.name,
      phone: row.phone,
      address: row.address,
      day: row.deliver_on,
      timeFrom: row.time_from,
      timeTo: row.time_to,
      note: row.note,
      total: roundMoney(Number(row.total)),
      toCollect: roundMoney(Number(row.to_collect)),
      status: row.status,
      late,
      takenBy: row.taken_by !== null && row.taken_by_name !== null ? { id: row.taken_by, name: row.taken_by_name } : null,
      deliveredBy: row.delivered_by_name,
      deliveredAt: row.delivered_at?.toISOString() ?? null,
      collected: row.collected === null ? null : roundMoney(Number(row.collected)),
      lastFailure: row.last_failure,
      failures: row.failures,
      lines: lines.filter((line) => line.document_id === row.document_id).map((line) => ({ productName: line.product_name, quantity: line.quantity })),
    };
  }

  /** What is still to take, by day and window, then the last two days' delivered ones. */
  async deliveries(now = new Date()): Promise<DeliveryDto[]> {
    const rows = await this.repository.findDeliveries(new Date(now.getTime() - DELIVERED_SHOWN_DAYS * 24 * 60 * 60 * 1000));
    const lines = await this.repository.documentLines(rows.map((row) => row.document_id));
    return rows.map((row) => this.deliveryDto(row, lines, now));
  }

  private async one(id: number, now = new Date()): Promise<DeliveryDto> {
    const row = await this.repository.findDelivery(id);
    if (!row) throw new NotFoundError(`Delivery ${id} does not exist`);
    return this.deliveryDto(row, await this.repository.documentLines([row.document_id]), now);
  }

  /** Where a customer had things taken last time, to fill in the next one. */
  lastAddress(customerId: number) {
    return this.repository.lastAddressOf(customerId);
  }

  /** "I'm taking it": the delivery is on its way with this person. */
  async take(id: number, actor: { id: number }, now = new Date()): Promise<DeliveryDto> {
    await this.transactions.run(async (repos) => {
      const row = await repos.salesDocs.findDelivery(id, true);
      if (!row) throw new NotFoundError(`Delivery ${id} does not exist`);
      if (row.status === 'delivered') throw new ConflictError('This one was delivered already');
      if (row.status === 'on_the_way' && row.taken_by !== actor.id) throw new ConflictError(`${row.taken_by_name ?? 'Someone'} is taking this one already`);
      await repos.salesDocs.updateDelivery(id, { status: 'on_the_way', taken_by: actor.id, taken_at: now });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'delivery.taken',
        entityType: 'document',
        entityId: row.document_id,
        say: { key: 'deliveryTaken', params: { number: row.document_number, name: row.name } },
      });
    });
    return this.one(id, now);
  }

  /**
   * Delivered, and what was collected at the door. The cash goes into the shop's
   * till under the person who brought it, only now; anything not collected stays
   * on the customer's tab.
   */
  async deliver(id: number, actor: { id: number }, collected: number, now = new Date()): Promise<DeliveryDto> {
    await this.transactions.run(async (repos) => {
      const row = await repos.salesDocs.findDelivery(id, true);
      if (!row) throw new NotFoundError(`Delivery ${id} does not exist`);
      if (row.status === 'delivered') throw new ConflictError('This one was delivered already');
      const toCollect = roundMoney(Number(row.to_collect));
      if (collected > toCollect) throw new ValidationError(`Only ${formatEuro(toCollect)} was to be collected`);
      let paymentId: number | null = null;
      if (collected > 0) {
        if (row.customer_id === null) throw new ConflictError('Nothing was to be collected for this one');
        paymentId = await receivePayment(
          repos,
          row.customer_id,
          { amount: collected, note: `Collected at the door, ${row.document_number}`, allocations: [{ documentId: row.document_id, amount: collected }] },
          actor.id,
          this.timeZone,
          now,
        );
      }
      await repos.salesDocs.updateDelivery(id, {
        status: 'delivered',
        delivered_by: actor.id,
        delivered_at: now,
        collected,
        payment_entry_id: paymentId,
        ...(row.taken_by === null && { taken_by: actor.id, taken_at: now }),
      });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'delivery.delivered',
        entityType: 'document',
        entityId: row.document_id,
        say: { key: 'deliveryDone', params: { number: row.document_number, name: row.name, collected } },
        details: { collected, toCollect },
      });
    });
    return this.one(id, now);
  }

  /** Not delivered: why, and back on the list (on another day when one is given). */
  async missed(id: number, actor: { id: number }, input: { reason: string; day: string | null }, now = new Date()): Promise<DeliveryDto> {
    if (input.day !== null && input.day < this.today(now)) throw new ValidationError('Pick today or a later day');
    await this.transactions.run(async (repos) => {
      const row = await repos.salesDocs.findDelivery(id, true);
      if (!row) throw new NotFoundError(`Delivery ${id} does not exist`);
      if (row.status === 'delivered') throw new ConflictError('This one was delivered already');
      await repos.salesDocs.updateDelivery(id, {
        status: 'waiting',
        taken_by: null,
        taken_at: null,
        last_failure: input.reason,
        failures: row.failures + 1,
        ...(input.day !== null && { deliver_on: input.day, time_from: null, time_to: null }),
      });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'delivery.missed',
        entityType: 'document',
        entityId: row.document_id,
        say: { key: 'deliveryMissed', params: { number: row.document_number, name: row.name, reason: input.reason } },
        details: { day: input.day },
      });
    });
    return this.one(id, now);
  }
}
