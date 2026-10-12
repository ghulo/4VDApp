import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CheckoutDayTotal, SaleRecord, SalesRepository } from '../repositories/SalesRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import type { UserRole } from '../database/types.js';
import { canOversee } from '../utils/roles.js';
import type { DocumentRef, DocumentService } from './DocumentService.js';
import { applyStockChange } from './InventoryService.js';
import { toMoney, toMoneyOrNull } from './mappers.js';
import { calculateUnitPrice } from './pricing/bulkPricing.js';
import type { SettingsService } from './SettingsService.js';
import { bestPromotionFor, priceWithPromotion } from './pricing/promotions.js';

export interface SaleDto {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  /** Rabat given at the counter, in percent; null when none. */
  discountPercent: number | null;
  totalAmount: number;
  soldBy: string | null;
  saleDate: string;
  notes: string | null;
  /** Units returned or waiting for a return decision. */
  returnedQuantity: number;
  /** The newest invoice the sale is on; null for sales from before documents. */
  invoice: DocumentRef | null;
}

/** Everything one customer bought at once: one invoice, one or more lines. */
export interface CheckoutDto {
  /** "i<invoice id>", or "s<sale id>" for an older sale without an invoice. */
  key: string;
  invoice: { id: number; number: string } | null;
  saleDate: string;
  /** The shop day it falls on, for grouping. */
  day: string;
  soldBy: string | null;
  total: number;
  lines: SaleDto[];
}

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
}

export interface BasketInput {
  /** `discountPercent`: rabat on that line; employees may give up to the shop's limit. */
  items: Array<{ productId: number; quantity: number; discountPercent?: number }>;
  notes: string | null;
  /** The registered customer it was for: on their tab, or paid at the till when `paidNow`. */
  customerId?: number;
  paidNow?: boolean;
}

export interface SaleQuery extends PageRequest {
  startDate?: Date;
  endDate?: Date;
  productId?: number;
  soldBy?: number;
  search?: string;
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
        limit: query.limit,
        offset: toOffset(query),
      },
      this.timeZone,
    );
    const lines = sales.map(toSaleDto);
    const items = keys.map((key) => {
      const own = lines.filter((sale) => (sale.invoice ? `i${sale.invoice.id}` : `s${sale.id}`) === key);
      const saleDate = own.reduce((latest, sale) => (sale.saleDate > latest ? sale.saleDate : latest), own[0]?.saleDate ?? '');
      return {
        key,
        invoice: own[0]?.invoice ?? null,
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
  async record(input: RecordSaleInput, soldBy: number): Promise<SaleDto> {
    if (input.saleDate && input.saleDate.getTime() > Date.now()) {
      throw new ValidationError('saleDate cannot be in the future');
    }

    const saleId = await this.transactions.run(async (repos) => {
      const id = await this.recordInTransaction(repos, input, soldBy);
      await this.documents.invoiceSales(repos, { saleIds: [id], customerId: input.customerId ?? null, onAccount: !input.paidNow, issuedBy: soldBy });
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
    const largest = Math.max(0, ...input.items.map((item) => item.discountPercent ?? 0));
    if (largest > 0 && !canOversee(seller.role)) {
      const limit = (await this.settings.get()).employeeDiscountLimit;
      if (largest > limit) throw new ForbiddenError(`You can give at most ${limit}% rabat. Ask the owner or an admin for more.`);
    }
    const { saleIds, invoice } = await this.transactions.run(async (repos) => {
      const saleIds: number[] = [];
      for (const item of input.items) {
        saleIds.push(await this.recordInTransaction(repos, { ...item, notes: input.notes, customerId: input.customerId, paidNow: input.paidNow }, soldBy));
      }
      const invoice = await this.documents.invoiceSales(repos, { saleIds, customerId: input.customerId ?? null, onAccount: !input.paidNow, issuedBy: soldBy });
      return { saleIds, invoice };
    });
    const sales = (await Promise.all(saleIds.map((id) => this.salesRepository.findById(id)))).map((sale) => toSaleDto(sale!));
    return { sales, total: roundMoney(sales.reduce((sum, sale) => sum + sale.totalAmount, 0)), invoice };
  }

  private async recordInTransaction(repos: TransactionalRepositories, input: RecordSaleInput, soldBy: number): Promise<number> {
    const product = await repos.products.findById(input.productId, false);
    if (!product) throw new NotFoundError(`Product ${input.productId} does not exist or is hidden`);

    const basePrice = toMoney(product.base_price);
    const tiers = await repos.pricingTiers.findByProductId(product.id);
    const promotions = await repos.promotions.findRunning(input.saleDate ?? new Date());
    const { pricePerUnit: listedPrice, promotionId } = priceWithPromotion(
      basePrice,
      calculateUnitPrice(basePrice, tiers, input.quantity),
      bestPromotionFor({ id: product.id, categoryId: product.category_id }, promotions),
    );
    // Rabat comes off the price the customer would otherwise pay (bulk price or promotion included).
    const discountPercent = input.discountPercent ? input.discountPercent : null;
    const pricePerUnit = discountPercent === null ? listedPrice : roundMoney(listedPrice * (1 - discountPercent / 100));

    const customer = input.customerId === undefined ? null : await repos.tabs.findCustomer(input.customerId);
    if (input.customerId !== undefined && (!customer || customer.archived_at)) {
      throw new NotFoundError(`Customer ${input.customerId} does not exist or their tab is closed`);
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
    });
    await applyStockChange(repos, {
      productId: product.id,
      productName: product.name,
      delta: -input.quantity,
      reason: SYSTEM_STOCK_REASONS.SALE,
      notes: `Sale #${id}`,
      adjustedBy: soldBy,
      reorderLevel: product.reorder_level ?? 0,
    });
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
      summary: `Sold ${input.quantity} × ${product.name} for ${formatEuro(total)}${discountPercent ? ` with ${discountPercent}% rabat` : ''}${customer ? (onTab ? ` on ${customer.name}'s tab` : ` to ${customer.name}`) : ''}`,
      details: { productId: product.id, quantity: input.quantity, pricePerUnit, promotionId, discountPercent, customerId: customer?.id ?? null, onTab },
    });
    return id;
  }
}

function toSaleDto(sale: SaleRecord): SaleDto {
  return {
    id: sale.id,
    productId: sale.product_id,
    productName: sale.product_name,
    quantity: sale.quantity_sold,
    pricePerUnit: toMoney(sale.price_per_unit),
    discountPercent: toMoneyOrNull(sale.discount_percent),
    totalAmount: toMoney(sale.total_amount),
    soldBy: sale.sold_by_name,
    saleDate: sale.sale_date.toISOString(),
    notes: sale.notes,
    returnedQuantity: Number(sale.returned_quantity),
    invoice: sale.invoice_id === null ? null : { id: sale.invoice_id, number: sale.invoice_number! },
  };
}
