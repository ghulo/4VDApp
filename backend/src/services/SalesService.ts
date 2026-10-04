import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { SaleRecord, SalesRepository } from '../repositories/SalesRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { applyStockChange } from './InventoryService.js';
import { toMoney, toMoneyOrNull } from './mappers.js';
import { calculateUnitPrice } from './pricing/bulkPricing.js';
import { bestPromotionFor, priceWithPromotion } from './pricing/promotions.js';

export interface SaleDto {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
  soldBy: string | null;
  saleDate: string;
  notes: string | null;
  /** Units returned or waiting for a return decision. */
  returnedQuantity: number;
}

export interface RecordSaleInput {
  productId: number;
  quantity: number;
  notes: string | null;
  /** For entering a sale after the fact. Defaults to now. */
  saleDate?: Date;
  /** Puts the sale on this customer's tab instead of taking the money now. */
  customerId?: number;
}

export interface BasketInput {
  items: Array<{ productId: number; quantity: number }>;
  notes: string | null;
  /** Puts the whole basket on this customer's tab. */
  customerId?: number;
}

export interface SaleQuery extends PageRequest {
  startDate?: Date;
  endDate?: Date;
  productId?: number;
  soldBy?: number;
}

export class SalesService {
  constructor(
    private readonly salesRepository: SalesRepository,
    private readonly transactions: TransactionManager,
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

  /**
   * Record a sale at the price for that quantity (bulk tiers, or a running
   * promotion when that is cheaper) and take the units out of stock. Both happen together or not at all, so
   * stock and sales history can never disagree.
   */
  async record(input: RecordSaleInput, soldBy: number): Promise<SaleDto> {
    if (input.saleDate && input.saleDate.getTime() > Date.now()) {
      throw new ValidationError('saleDate cannot be in the future');
    }

    const saleId = await this.transactions.run((repos) => this.recordInTransaction(repos, input, soldBy));

    const sale = await this.salesRepository.findById(saleId);
    return toSaleDto(sale!);
  }

  /**
   * Several products sold together, as one checkout: each becomes its own sale
   * (so returns, undo and reports work per product), all saved or none.
   */
  async recordBasket(input: BasketInput, soldBy: number): Promise<{ sales: SaleDto[]; total: number }> {
    const ids = await this.transactions.run(async (repos) => {
      const saleIds: number[] = [];
      for (const item of input.items) {
        saleIds.push(await this.recordInTransaction(repos, { ...item, notes: input.notes, customerId: input.customerId }, soldBy));
      }
      return saleIds;
    });
    const sales = (await Promise.all(ids.map((id) => this.salesRepository.findById(id)))).map((sale) => toSaleDto(sale!));
    return { sales, total: roundMoney(sales.reduce((sum, sale) => sum + sale.totalAmount, 0)) };
  }

  private async recordInTransaction(repos: TransactionalRepositories, input: RecordSaleInput, soldBy: number): Promise<number> {
    const product = await repos.products.findById(input.productId, false);
    if (!product) throw new NotFoundError(`Product ${input.productId} does not exist or is hidden`);

    const basePrice = toMoney(product.base_price);
    const tiers = await repos.pricingTiers.findByProductId(product.id);
    const promotions = await repos.promotions.findRunning(input.saleDate ?? new Date());
    const { pricePerUnit, promotionId } = priceWithPromotion(
      basePrice,
      calculateUnitPrice(basePrice, tiers, input.quantity),
      bestPromotionFor({ id: product.id, categoryId: product.category_id }, promotions),
    );

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
    if (customer) {
      await repos.tabs.addEntry({
        customerId: customer.id,
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
      summary: `Sold ${input.quantity} × ${product.name} for ${formatEuro(total)}${customer ? ` on ${customer.name}'s tab` : ''}`,
      details: { productId: product.id, quantity: input.quantity, pricePerUnit, promotionId, customerId: customer?.id ?? null },
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
    totalAmount: toMoney(sale.total_amount),
    soldBy: sale.sold_by_name,
    saleDate: sale.sale_date.toISOString(),
    notes: sale.notes,
    returnedQuantity: Number(sale.returned_quantity),
  };
}
