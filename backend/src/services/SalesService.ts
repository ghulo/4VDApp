import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { SaleRecord, SalesRepository } from '../repositories/SalesRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { applyStockChange } from './InventoryService.js';
import { toMoney } from './mappers.js';
import { calculateUnitPrice } from './pricing/bulkPricing.js';

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
}

export interface RecordSaleInput {
  productId: number;
  quantity: number;
  notes: string | null;
  /** For entering a sale after the fact. Defaults to now. */
  saleDate?: Date;
}

export interface SaleQuery extends PageRequest {
  startDate?: Date;
  endDate?: Date;
  productId?: number;
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
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: sales.map(toSaleDto), meta: toPaginationMeta(query, total), revenue };
  }

  /**
   * Record a sale at today's price for that quantity (bulk tiers included)
   * and take the units out of stock. Both happen together or not at all, so
   * stock and sales history can never disagree.
   */
  async record(input: RecordSaleInput, soldBy: number): Promise<SaleDto> {
    if (input.saleDate && input.saleDate.getTime() > Date.now()) {
      throw new ValidationError('saleDate cannot be in the future');
    }

    const saleId = await this.transactions.run(async (repos) => {
      const product = await repos.products.findById(input.productId, false);
      if (!product) throw new NotFoundError(`Product ${input.productId} does not exist or is hidden`);

      const tiers = await repos.pricingTiers.findByProductId(product.id);
      const pricePerUnit = calculateUnitPrice(toMoney(product.base_price), tiers, input.quantity);

      const id = await repos.sales.create({
        productId: product.id,
        quantity: input.quantity,
        pricePerUnit,
        soldBy,
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
      return id;
    });

    const sale = await this.salesRepository.findById(saleId);
    return toSaleDto(sale!);
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
  };
}
