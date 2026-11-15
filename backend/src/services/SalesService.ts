import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { allowsParts } from '../constants/units.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { receivePayment } from './TabService.js';
import type { CheckoutDayTotal, SaleRecord, SalesRepository } from '../repositories/SalesRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { addDays, zonedDay } from '../utils/zonedDates.js';
import { assertMonthsOpen } from './vat/periodLock.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import type { UserRole } from '../database/types.js';
import { canOversee } from '../utils/roles.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import type { DocumentRef, DocumentService } from './DocumentService.js';
import { applyStockChange } from './InventoryService.js';
import { toMoney, toMoneyOrNull } from './mappers.js';
import type { SettingsService } from './SettingsService.js';
import { bestPromotionFor } from './pricing/promotions.js';
import { batchesLeft, shortDatedOffer } from './ExpiryService.js';
import { listPrice } from './pricing/salePrice.js';
import type { RecordSource } from '../validators/validate.js';
import { readRules } from './shopRules.js';

export interface SaleDto {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  /** Rabat given at the counter, in percent; null when none. */
  discountPercent: number | null;
  /** Sold at a short-dated price: this much off the shelf price. */
  shortDatedPercent: number | null;
  totalAmount: number;
  soldBy: string | null;
  saleDate: string;
  notes: string | null;
  /** The old till's receipt number, on sales imported from it. */
  receiptNo: string | null;
  /** Sold at the wholesale price. */
  wholesale: boolean;
  /** Units returned or waiting for a return decision. */
  returnedQuantity: number;
  /** The newest invoice the sale is on; null for sales from before documents. */
  invoice: DocumentRef | null;
}

/** Everything one customer bought at once: one invoice, one or more lines. */
export interface CheckoutDto {
  /** "i<invoice id>", "r<receipt no>@<day>" for an imported receipt, or "s<sale id>" for an older sale with neither. */
  key: string;
  invoice: { id: number; number: string } | null;
  /** The old till's receipt number, when the checkout was imported from it. */
  receiptNo: string | null;
  saleDate: string;
  /** The shop day it falls on, for grouping. */
  day: string;
  soldBy: string | null;
  total: number;
  lines: SaleDto[];
}

/** How far ahead of the server's clock an offline sale's time may be (the PC's clock drifts). */
const CLOCK_SLACK_MS = 5 * 60_000;

const roundQuantity = (value: number) => Math.round(value * 1000) / 1000;

export interface RecordSaleInput {
  productId: number;
  quantity: number;
  notes: string | null;
  /** For entering a sale after the fact. Defaults to now. */
  saleDate?: Date;
  /** The registered customer it was for: on their tab, or paid at the till when `paidNow`. */
  customerId?: number;
  paidNow?: boolean;
  /** Rabat off the price for this quantity, in percent. */
  discountPercent?: number;
  /** Made offline at the Counter: the shelf may have had less than 4VD thought, so stock goes to 0 instead of refusing. */
  offline?: boolean;
  /** The price for one agreed in an offer: used as it is, instead of the shelf price and rabat. */
  fixedPrice?: number;
  /** Wholesale prices on or off for this sale; left out: what the customer pays. */
  wholesale?: boolean;
  /** A stickered unit from this short-dated batch (an expiry date): sold at its short-dated price when that is the lowest. */
  shortDatedId?: number;
}

/** A sale taken to the customer: where and when, and whether the money is paid in the shop or at the door. */
export interface DeliveryInput {
  name: string;
  phone: string | null;
  address: string;
  /** "YYYY-MM-DD"; the window is "HH:MM", or none. */
  day: string;
  timeFrom: string | null;
  timeTo: string | null;
  note: string | null;
  /** 'shop': paid in full now, the usual way. 'door': the rest is collected at the door (`paidNow` in cash now, maybe 0). */
  payment: 'shop' | 'door';
  paidNow?: number;
}

export interface BasketInput {
  /** `discountPercent`: rabat on that line; employees may give up to the shop's limit. */
  items: Array<{ productId: number; quantity: number; discountPercent?: number; offerPrice?: number; shortDatedId?: number }>;
  notes: string | null;
  /** The registered customer it was for: on their tab, or paid at the till when `paidNow`. */
  customerId?: number;
  paidNow?: boolean;
  /** Wholesale prices on or off for this sale; left out: what the customer pays. */
  wholesale?: boolean;
  /** Money paid now: cash into the drawer (the default) or a card on the bank's terminal. */
  paidBy?: 'cash' | 'card';
  /** Split payment: this much on the card terminal, the rest in cash. */
  cardAmount?: number;
  /** An owner's one-time yes (Counter PIN) to a rabat over the employee limit. */
  rabatApproval?: string;
  /** The key the Counter gave the sale at Pay: a sale sent twice is recorded once. */
  clientKey?: string;
  /** A sale the Counter made offline: when it was made. It is recorded at that time, and may sell past stock. */
  soldAt?: Date;
  /** On a customer's tab: the day they promised to pay ("YYYY-MM-DD"); the shop's payment terms when left out. */
  dueDate?: string;
  /** An owner's one-time yes (Counter PIN) to putting this sale on the customer's tab. */
  payLaterApproval?: string;
  /** The offer the customer said yes to: lines with `offerPrice` sell at the offered price, and the offer is marked sold. */
  offerId?: number;
  delivery?: DeliveryInput;
}

export interface SaleQuery extends PageRequest {
  startDate?: Date;
  endDate?: Date;
  productId?: number;
  soldBy?: number;
  search?: string;
  source?: RecordSource;
}

export class SalesService {
  constructor(
    private readonly salesRepository: SalesRepository,
    private readonly transactions: TransactionManager,
    private readonly documents: DocumentService,
    private readonly timeZone: string,
    private readonly settings: SettingsService,
  ) {}

  async list(query: SaleQuery) {
    const { sales, total, revenue } = await this.salesRepository.findMany({
      startDate: query.startDate,
      endDate: query.endDate,
      productId: query.productId,
      soldBy: query.soldBy,
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: sales.map(toSaleDto), meta: toPaginationMeta(query, total), revenue };
  }

  /** Sales history by checkout (DESIGN.md 3.5): one row per invoice, opening to its lines. */
  async checkouts(
    query: SaleQuery,
  ): Promise<{ items: CheckoutDto[]; meta: ReturnType<typeof toPaginationMeta>; revenue: number; days: CheckoutDayTotal[] }> {
    const { sales, keys, total, revenue, days } = await this.salesRepository.findCheckouts(
      {
        startDate: query.startDate,
        endDate: query.endDate,
        productId: query.productId,
        soldBy: query.soldBy,
        search: query.search,
        source: query.source,
        limit: query.limit,
        offset: toOffset(query),
      },
      this.timeZone,
    );
    const lines = sales.map(toSaleDto);
    const items = keys.map((key) => {
      const own = lines.filter((sale) => checkoutKey(sale, this.timeZone) === key);
      const saleDate = own.reduce((latest, sale) => (sale.saleDate > latest ? sale.saleDate : latest), own[0]?.saleDate ?? '');
      return {
        key,
        invoice: own[0]?.invoice ?? null,
        receiptNo: own[0]?.receiptNo ?? null,
        saleDate,
        day: zonedDay(new Date(saleDate), this.timeZone),
        soldBy: own[0]?.soldBy ?? null,
        total: roundMoney(own.reduce((sum, sale) => sum + sale.totalAmount, 0)),
        lines: own,
      };
    });
    return { items, meta: toPaginationMeta(query, total), revenue, days };
  }

  /**
   * Record a sale at the price for that quantity (bulk tiers, or a running
   * promotion when that is cheaper) and take the units out of stock. Both happen together or not at all, so
   * stock and sales history can never disagree.
   */
  async record(input: RecordSaleInput, seller: number | { id: number; role: UserRole }): Promise<SaleDto> {
    const soldBy = typeof seller === 'number' ? seller : seller.id;
    if (input.saleDate && input.saleDate.getTime() > Date.now()) {
      throw new ValidationError('saleDate cannot be in the future');
    }

    const saleId = await this.transactions.run(async (repos) => {
      if (typeof seller !== 'number') await assertMayWholesale(repos, seller.role, input.customerId, input.wholesale);
      const id = await this.recordInTransaction(repos, input, soldBy);
      // A seed or script passes only an id: it acts for the owner.
      if (typeof seller !== 'number' && input.customerId !== undefined && !input.paidNow) {
        const sale = await repos.sales.findById(id);
        await this.checkPayLater(repos, seller, input.customerId, Number(sale!.total_amount));
      }
      // Entered after the fact: due the shop's payment terms after the day it was sold, not after today.
      const dueDate =
        input.saleDate && input.customerId !== undefined && !input.paidNow
          ? addDays(zonedDay(input.saleDate, this.timeZone), (await this.settings.get()).paymentTermsDays)
          : undefined;
      await this.documents.invoiceSales(repos, { saleIds: [id], customerId: input.customerId ?? null, onAccount: !input.paidNow, issuedBy: soldBy, dueDate });
      return id;
    });

    const sale = await this.salesRepository.findById(saleId);
    return toSaleDto(sale!);
  }

  /**
   * Several products sold together, as one checkout: each becomes its own sale
   * (so returns, undo and reports work per product), all on one invoice, all
   * saved or none.
   */
  async recordBasket(input: BasketInput, seller: { id: number; role: UserRole }): Promise<{ sales: SaleDto[]; total: number; invoice: DocumentRef }> {
    const soldBy = seller.id;
    if (input.soldAt && input.soldAt.getTime() > Date.now() + CLOCK_SLACK_MS) throw new ValidationError('soldAt cannot be in the future');
    // Sent before: the answer was lost on the way, so give the same one again.
    if (input.clientKey) {
      const sent = await this.alreadySent(input.clientKey);
      if (sent) return sent;
    }
    if (input.items.some((item) => item.offerPrice !== undefined) && input.offerId === undefined) throw new ValidationError('An offered price needs its offer');
    const delivery = input.delivery;
    const atDoor = delivery?.payment === 'door';
    if (delivery && input.soldAt) throw new ValidationError('A delivery needs the internet: record it once it is back');
    const today = zonedDay(new Date(), this.timeZone);
    if (input.dueDate !== undefined && input.dueDate < today) throw new ValidationError('The day they promise to pay can’t be before today');
    if (delivery && delivery.day < today) throw new ValidationError('Pick today or a later day for the delivery');
    if (atDoor && (input.paidBy === 'card' || input.cardAmount)) throw new ValidationError('Money taken now for a delivery is cash; the rest is collected at the door');
    const largest = Math.max(0, ...input.items.map((item) => item.discountPercent ?? 0));
    let needsApproval = false;
    if (largest > 0 && !canOversee(seller.role)) {
      const limit = (await this.settings.get()).employeeDiscountLimit;
      needsApproval = largest > limit;
      if (needsApproval && !input.rabatApproval) throw new ForbiddenError(`You can give at most ${limit}% rabat. Ask the owner or an admin for more.`);
    }
    const saleDate = input.soldAt && new Date(Math.min(input.soldAt.getTime(), Date.now()));
    let recorded: { saleIds: number[]; invoice: DocumentRef };
    try {
      recorded = await this.transactions.run(async (repos) => {
        // Used up only when the sale goes through.
        if (needsApproval && !(await repos.pins.consumeApproval(input.rabatApproval!, seller.id, largest))) {
          throw new ForbiddenError('The owner’s yes to this rabat has run out or was used already. Ask again.');
        }
        const offerPrices = await this.offerPrices(repos, input);
        // Paid at the door: the sale goes on the customer's tab (a new one from the delivery's name when there is none) until it is collected.
        let customerId = input.customerId;
        if (delivery && atDoor && customerId === undefined) {
          customerId = await repos.tabs.createCustomer({
            name: delivery.name,
            kind: 'person',
            nui: null,
            phone: delivery.phone,
            note: null,
            address: delivery.address,
            createdBy: soldBy,
          });
        }
        await assertMayWholesale(repos, seller.role, customerId, input.wholesale);
        const paidNow = atDoor ? false : input.paidNow;
        const saleIds: number[] = [];
        for (const item of input.items) {
          const { offerPrice, ...rest } = item;
          saleIds.push(
            await this.recordInTransaction(
              repos,
              {
                ...rest,
                ...(offerPrice !== undefined && { fixedPrice: offerPrices.get(item.productId) }),
                notes: input.notes,
                customerId,
                paidNow,
                saleDate,
                offline: Boolean(input.soldAt),
                wholesale: input.wholesale,
              },
              soldBy,
            ),
          );
        }
        const sold = await Promise.all(saleIds.map((id) => repos.sales.findById(id)));
        const total = roundMoney(sold.reduce((sum, sale) => sum + Number(sale!.total_amount), 0));
        if (customerId !== undefined && !paidNow && !atDoor) await this.checkPayLater(repos, seller, customerId, total, input.payLaterApproval);
        const invoice = await this.documents.invoiceSales(repos, {
          saleIds,
          customerId: customerId ?? null,
          onAccount: !paidNow,
          issuedBy: soldBy,
          byCard: input.paidBy === 'card',
          cardAmount: input.cardAmount,
          clientKey: input.clientKey,
          dueDate: delivery && atDoor ? delivery.day : input.dueDate,
        });
        if (input.offerId !== undefined && !(await repos.salesDocs.decideOffer(input.offerId, 'sold', invoice.id))) {
          throw new ConflictError('That offer was sold or turned down already');
        }
        if (delivery) await this.addDelivery(repos, { delivery, customerId: customerId ?? null, total, invoiceId: invoice.id, soldBy });
        return { saleIds, invoice };
      });
    } catch (error) {
      // The same sale sent twice at once: the other one got in first.
      const sent = input.clientKey && isUniqueViolation(error, 'documents_client_key_key') ? await this.alreadySent(input.clientKey) : undefined;
      if (sent) return sent;
      throw error;
    }
    return this.basketResult(recorded.saleIds, recorded.invoice);
  }

  /** The offered price of each product the basket sells from the offer; the offer must still be open and offer it at that price. */
  private async offerPrices(repos: TransactionalRepositories, input: BasketInput): Promise<Map<number, number>> {
    const prices = new Map<number, number>();
    if (input.offerId === undefined) return prices;
    const offer = await repos.salesDocs.findOffer(input.offerId);
    if (!offer) throw new NotFoundError(`Offer ${input.offerId} does not exist`);
    if (offer.status !== 'open') throw new ConflictError(`Offer ${offer.number} was ${offer.status === 'sold' ? 'sold' : 'turned down'} already`);
    const lines = await repos.salesDocs.offerLines(offer.id);
    for (const item of input.items) {
      if (item.offerPrice === undefined) continue;
      const line = lines.find((candidate) => candidate.product_id === item.productId);
      if (!line || roundMoney(Number(line.unit_price)) !== roundMoney(item.offerPrice)) {
        throw new ValidationError(`Offer ${offer.number} doesn't offer that price for this product`);
      }
      prices.set(item.productId, Number(line.unit_price));
    }
    return prices;
  }

  /**
   * Only the owner's side decides who pays later. Anyone else may put a sale on
   * a tab only for a customer the owner let pay later, within their limit, or
   * with the owner's one-time yes (Counter PIN).
   */
  private async checkPayLater(
    repos: TransactionalRepositories,
    seller: { id: number; role: UserRole },
    customerId: number,
    total: number,
    approval?: string,
  ): Promise<void> {
    if (canOversee(seller.role)) return;
    const customer = await repos.tabs.findCustomer(customerId);
    if (!customer) throw new NotFoundError(`Customer ${customerId} does not exist`);
    const limit = customer.credit_limit === null ? null : Number(customer.credit_limit);
    // The sale is on the tab already (inside this transaction), so the balance includes it.
    const balance = await repos.tabs.balance(customerId);
    if (customer.pay_later && (limit === null || balance <= limit)) return;
    if (approval && (await repos.pins.consumePayLater(approval, seller.id, customerId, total))) return;
    if (approval) throw new ForbiddenError('The owner’s yes to paying later has run out or was for less. Ask again.');
    throw new ForbiddenError(
      customer.pay_later
        ? `${customer.name} may owe at most ${formatEuro(limit!)}; with this sale they would owe ${formatEuro(balance)}. Ask the owner.`
        : `${customer.name} isn't let pay later yet. Ask the owner.`,
    );
  }

  private async addDelivery(
    repos: TransactionalRepositories,
    p: { delivery: DeliveryInput; customerId: number | null; total: number; invoiceId: number; soldBy: number },
  ): Promise<void> {
    const { delivery } = p;
    const paidNow = delivery.payment === 'door' ? roundMoney(delivery.paidNow ?? 0) : p.total;
    if (delivery.payment === 'door' && paidNow >= p.total) {
      throw new ValidationError(`Paid now must be less than ${formatEuro(p.total)}; for all of it, choose Paid in the shop`);
    }
    if (delivery.payment === 'door' && paidNow > 0) {
      await receivePayment(
        repos,
        p.customerId!,
        { amount: paidNow, note: 'Paid in the shop, before delivery', allocations: [{ documentId: p.invoiceId, amount: paidNow }] },
        p.soldBy,
        this.timeZone,
        new Date(),
      );
    }
    await repos.salesDocs.createDelivery({
      documentId: p.invoiceId,
      customerId: p.customerId,
      name: delivery.name,
      phone: delivery.phone,
      address: delivery.address,
      deliverOn: delivery.day,
      timeFrom: delivery.timeFrom,
      timeTo: delivery.timeTo,
      note: delivery.note,
      total: p.total,
      toCollect: roundMoney(p.total - paidNow),
      createdBy: p.soldBy,
    });
  }

  private async alreadySent(clientKey: string): Promise<{ sales: SaleDto[]; total: number; invoice: DocumentRef } | undefined> {
    const document = await this.transactions.run((repos) => repos.documents.findByClientKey(clientKey));
    return document && this.basketResult(document.saleIds, { id: document.id, number: document.number });
  }

  private async basketResult(saleIds: number[], invoice: DocumentRef): Promise<{ sales: SaleDto[]; total: number; invoice: DocumentRef }> {
    const sales = (await Promise.all(saleIds.map((id) => this.salesRepository.findById(id)))).map((sale) => toSaleDto(sale!));
    return { sales, total: roundMoney(sales.reduce((sum, sale) => sum + sale.totalAmount, 0)), invoice };
  }

  /**
   * Whether a sale may go past what 4VD thinks is on the shelf: always when the
   * shop says so, and for owners and admins even when it doesn't.
   */
  private async sellsPastStock(repos: TransactionalRepositories, soldBy: number): Promise<boolean> {
    if ((await readRules(repos.settings)).noStockSales === 'allow') return true;
    const seller = await repos.users.findById(soldBy);
    return canOversee(seller?.role);
  }

  private async recordInTransaction(repos: TransactionalRepositories, input: RecordSaleInput, soldBy: number): Promise<number> {
    await assertMonthsOpen(repos.periods, [zonedDay(input.saleDate ?? new Date(), this.timeZone)]);
    const product = await repos.products.findById(input.productId, false);
    if (!product) throw new NotFoundError(`Product ${input.productId} does not exist or is hidden`);

    const customer = input.customerId === undefined ? null : await repos.tabs.findCustomer(input.customerId);
    if (input.customerId !== undefined && (!customer || customer.archived_at)) {
      throw new NotFoundError(`Customer ${input.customerId} does not exist or their tab is closed`);
    }
    const tiers = await repos.pricingTiers.findByProductId(product.id);
    const promotions = await repos.promotions.findRunning(input.saleDate ?? new Date());
    const priced = listPrice({
      shelfPrice: toMoney(product.base_price),
      wholesalePrice: toMoneyOrNull(product.wholesale_price),
      wholesale: input.wholesale ?? customer?.pays_wholesale ?? false,
      tiers,
      quantity: input.quantity,
      promotion: bestPromotionFor({ id: product.id, categoryId: product.category_id }, promotions),
    });
    let { pricePerUnit: listedPrice, promotionId } = priced;
    // A stickered short-dated unit: its price competes with the rest, the lowest wins (discounts never stack).
    let shortDatedPercent: number | null = null;
    const expiryDateId = input.shortDatedId ?? null;
    if (expiryDateId !== null) {
      const batches = batchesLeft(await repos.expiry.findOpen({ productId: product.id }));
      const batch = batches.find((candidate) => candidate.row.id === expiryDateId);
      const offer = batch && shortDatedOffer(batch.row, zonedDay(input.saleDate ?? new Date(), this.timeZone), (await readRules(repos.settings)).shortDated);
      // Offline, the shelf decided and the customer already paid: sell what it can, never refuse.
      if (!input.offline) {
        if (!batch || !offer) throw new ValidationError(`${product.name} is no longer sold short-dated. Take it off the basket and scan it again.`);
        if (input.quantity > batch.remaining) throw new ValidationError(`Only ${batch.remaining} × ${product.name} are short-dated`);
      }
      if (offer && offer.price < listedPrice) {
        listedPrice = offer.price;
        promotionId = null;
        shortDatedPercent = offer.percentOff;
      }
    }
    // Rabat comes off the price the customer would otherwise pay (bulk price or promotion included).
    let discountPercent = input.discountPercent ? input.discountPercent : null;
    let pricePerUnit = discountPercent === null ? listedPrice : roundMoney(listedPrice * (1 - discountPercent / 100));
    // An offered price is kept to the cent; the rabat it makes is recorded for the reports.
    if (input.fixedPrice !== undefined) {
      pricePerUnit = roundMoney(input.fixedPrice);
      discountPercent = pricePerUnit < listedPrice && listedPrice > 0 ? Math.round((1 - pricePerUnit / listedPrice) * 10000) / 100 : null;
    }

    const id = await repos.sales.create({
      productId: product.id,
      quantity: input.quantity,
      pricePerUnit,
      unitCost: toMoneyOrNull(product.cost_price),
      soldBy,
      promotionId,
      discountPercent,
      priceBeforeDiscount: discountPercent === null ? null : listedPrice,
      notes: input.notes,
      saleDate: input.saleDate,
      wholesale: priced.wholesale,
      expiryDateId: input.shortDatedId === undefined ? null : input.shortDatedId,
      shortDatedPercent,
    });
    // Offline, the shelf decided: what 4VD didn't know about is taken to 0 and asked to be counted.
    let taken = input.quantity;
    if (input.offline || (await this.sellsPastStock(repos, soldBy))) {
      if (!Number.isInteger(input.quantity) && !allowsParts(product.unit)) {
        throw new ValidationError(`${product.name} is sold by the piece: use a whole number, not ${input.quantity}`);
      }
      const onHand = await repos.inventory.onHandForUpdate(product.id);
      if (onHand < input.quantity) {
        taken = Math.max(0, onHand);
        await repos.shortfalls.add({ productId: product.id, saleId: id, shortBy: roundQuantity(input.quantity - taken), soldBy, soldAt: input.saleDate ?? new Date() });
      }
    }
    if (taken > 0) {
      await applyStockChange(repos, {
        productId: product.id,
        productName: product.name,
        delta: -taken,
        reason: SYSTEM_STOCK_REASONS.SALE,
        notes: taken < input.quantity ? `Sale #${id} (${input.offline ? 'offline, ' : ''}${roundQuantity(input.quantity - taken)} more than in stock)` : `Sale #${id}`,
        adjustedBy: soldBy,
        reorderLevel: product.reorder_level ?? 0,
      });
    }
    const total = roundMoney(pricePerUnit * input.quantity);
    const tabOf = input.paidNow ? null : customer;
    const onTab = Boolean(tabOf);
    if (tabOf) {
      await repos.tabs.addEntry({
        customerId: tabOf.id,
        kind: 'charge',
        amount: total,
        note: `${input.quantity} × ${product.name}`,
        saleId: id,
        createdBy: soldBy,
        occurredAt: input.saleDate,
      });
    }
    await repos.activityLog.create({
      userId: soldBy,
      action: 'sale.recorded',
      entityType: 'sale',
      entityId: id,
      say: { key: 'sold', params: { quantity: input.quantity, product: product.name, total, discount: discountPercent ? discountPercent : null, customer: customer?.name ?? null, onTab } },
      details: { productId: product.id, quantity: input.quantity, pricePerUnit, promotionId, discountPercent, shortDatedPercent, expiryDateId, customerId: customer?.id ?? null, onTab },
    });
    return id;
  }
}

/** Which checkout a sale belongs to; the same key findCheckouts groups by. */
function checkoutKey(sale: SaleDto, timeZone: string): string {
  if (sale.invoice) return `i${sale.invoice.id}`;
  if (sale.receiptNo) return `r${sale.receiptNo}@${zonedDay(new Date(sale.saleDate), timeZone)}`;
  return `s${sale.id}`;
}

function toSaleDto(sale: SaleRecord): SaleDto {
  return {
    id: sale.id,
    productId: sale.product_id,
    productName: sale.product_name,
    quantity: sale.quantity_sold,
    pricePerUnit: toMoney(sale.price_per_unit),
    discountPercent: toMoneyOrNull(sale.discount_percent),
    shortDatedPercent: toMoneyOrNull(sale.short_dated_percent),
    totalAmount: toMoney(sale.total_amount),
    soldBy: sale.sold_by_name,
    saleDate: sale.sale_date.toISOString(),
    notes: sale.notes,
    receiptNo: sale.receipt_no,
    wholesale: sale.wholesale,
    returnedQuantity: Number(sale.returned_quantity),
    invoice: sale.invoice_id === null ? null : { id: sale.invoice_id, number: sale.invoice_number! },
  };
}

/**
 * Wholesale prices switched on for one sale go below the shelf price, like a
 * rabat: only the owner's side may do it, unless the customer pays wholesale anyway.
 */
async function assertMayWholesale(repos: TransactionalRepositories, role: UserRole, customerId: number | undefined, wholesale: boolean | undefined): Promise<void> {
  if (wholesale !== true || canOversee(role)) return;
  const customer = customerId === undefined ? undefined : await repos.tabs.findCustomer(customerId);
  if (customer?.pays_wholesale) return;
  throw new ForbiddenError('Only the owner or an admin can sell at wholesale prices to this customer');
}
