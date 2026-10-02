import { DEFAULT_REORDER_LEVEL, SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import type { UserRole } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CategoryRepository } from '../repositories/CategoryRepository.js';
import type { PricingTierRepository } from '../repositories/PricingTierRepository.js';
import type { ProductData, ProductRecord, ProductRepository } from '../repositories/ProductRepository.js';
import type { PromotionRepository } from '../repositories/PromotionRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { type ProductSnapshot, describeProductChanges } from './activity/describeProductChanges.js';
import { isLowStock } from './inventory/stockAlerts.js';
import { toMoney, toMoneyOrNull } from './mappers.js';
import { type PricingTier, validatePricingTiers } from './pricing/bulkPricing.js';
import { bestPromotionFor, discountedPrice, type RunningPromotion } from './pricing/promotions.js';
import { canOversee } from '../utils/roles.js';

export interface ProductDto {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  imageUrl: string | null;
  isActive: boolean;
  category: { id: number; name: string };
  price: number;
  /** Only included for admins. */
  costPrice?: number | null;
  stock: { quantity: number; reorderLevel: number; isInStock: boolean; isLowStock: boolean };
  bulkPricingTiers: PricingTier[];
  /** The running promotion for this product, with the price it gives for one unit. */
  promotion: { id: number; name: string; percentOff: number; endsAt: string; price: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  description: string | null;
  categoryId: number;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  sku: string | null;
  isActive: boolean;
  /** Replaces every tier when given; leaves them unchanged when undefined (updates only). */
  bulkPricingTiers?: PricingTier[];
}

export interface NewProductInput extends ProductInput {
  stock: number;
  reorderLevel?: number;
}

export interface ProductQuery extends PageRequest {
  categoryId?: number;
  search?: string;
  inStock?: boolean;
}

const SKU_TAKEN_MESSAGE = (sku: string) => `Another product already uses SKU "${sku}"`;

export class ProductService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly pricingTierRepository: PricingTierRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async list(query: ProductQuery, viewerRole: UserRole | undefined): Promise<Paginated<ProductDto>> {
    const isAdmin = canOversee(viewerRole);
    const { products, total } = await this.productRepository.findMany({
      categoryId: query.categoryId,
      search: query.search,
      inStock: query.inStock,
      includeInactive: isAdmin,
      limit: query.limit,
      offset: toOffset(query),
    });
    const [tiersByProduct, promotions] = await Promise.all([
      this.pricingTierRepository.findByProductIds(products.map((product) => product.id)),
      this.promotionRepository.findRunning(new Date()),
    ]);

    return {
      items: products.map((product) => this.toDto(product, tiersByProduct.get(product.id) ?? [], promotions, isAdmin)),
      meta: toPaginationMeta(query, total),
    };
  }

  async getById(id: number, viewerRole: UserRole | undefined): Promise<ProductDto> {
    const isAdmin = canOversee(viewerRole);
    const product = await this.productRepository.findById(id, isAdmin);
    if (!product) throw new NotFoundError(`Product ${id} does not exist`);
    const [tiers, promotions] = await Promise.all([
      this.pricingTierRepository.findByProductId(id),
      this.promotionRepository.findRunning(new Date()),
    ]);
    return this.toDto(product, tiers, promotions, isAdmin);
  }

  /** Products in the same order as `ids`, skipping any that no longer exist. */
  async getManyByIds(ids: number[], viewerRole: UserRole | undefined): Promise<ProductDto[]> {
    const isAdmin = canOversee(viewerRole);
    const products = await this.productRepository.findByIds(ids, isAdmin);
    const [tiersByProduct, promotions] = await Promise.all([
      this.pricingTierRepository.findByProductIds(products.map((product) => product.id)),
      this.promotionRepository.findRunning(new Date()),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    return ids
      .map((id) => productById.get(id))
      .filter((product): product is ProductRecord => product !== undefined)
      .map((product) => this.toDto(product, tiersByProduct.get(product.id) ?? [], promotions, isAdmin));
  }

  /**
   * Creates the product, its stock record and its pricing tiers together, and
   * logs the starting stock in the audit trail. All or nothing.
   */
  async create(input: NewProductInput, createdBy: number): Promise<ProductDto> {
    await this.ensureCategoryExists(input.categoryId);
    const tiers = validatePricingTiers(input.price, input.bulkPricingTiers ?? []);

    try {
      const productId = await this.transactions.run(async (repos) => {
        const id = await repos.products.create(this.toProductData(input));
        await repos.inventory.create(id, input.stock, input.reorderLevel ?? DEFAULT_REORDER_LEVEL);
        await repos.pricingTiers.replaceForProduct(id, tiers);
        if (input.stock > 0) {
          await repos.stockAdjustments.create({
            productId: id,
            quantity: input.stock,
            reason: SYSTEM_STOCK_REASONS.INITIAL_STOCK,
            notes: null,
            adjustedBy: createdBy,
          });
        }
        await repos.activityLog.create({
          userId: createdBy,
          action: 'product.created',
          entityType: 'product',
          entityId: id,
          summary: `Added product ${input.name}`,
          details: { price: input.price, costPrice: input.costPrice, stock: input.stock },
        });
        return id;
      });
      return this.getById(productId, 'admin');
    } catch (error) {
      if (isUniqueViolation(error) && input.sku) throw new ConflictError(SKU_TAKEN_MESSAGE(input.sku));
      throw error;
    }
  }

  /** Full update. Stock is deliberately not editable here; use the inventory endpoint. */
  async update(id: number, input: ProductInput, actorId: number): Promise<ProductDto> {
    const existing = await this.productRepository.findById(id, true);
    if (!existing) throw new NotFoundError(`Product ${id} does not exist`);
    await this.ensureCategoryExists(input.categoryId);

    const existingTiers = await this.pricingTierRepository.findByProductId(id);
    // If the price changed but tiers were not sent, the existing tiers must
    // still be valid against the new price.
    const tiers = validatePricingTiers(input.price, input.bulkPricingTiers ?? existingTiers);
    const change = describeProductChanges(toSnapshot(existing, existingTiers), {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      price: input.price,
      costPrice: input.costPrice,
      imageUrl: input.imageUrl,
      sku: input.sku,
      isActive: input.isActive,
      bulkPricingTiers: input.bulkPricingTiers ? tiers : undefined,
    });

    try {
      await this.transactions.run(async (repos) => {
        await repos.products.update(id, this.toProductData(input));
        if (input.bulkPricingTiers) await repos.pricingTiers.replaceForProduct(id, tiers);
        if (change) {
          await repos.activityLog.create({
            userId: actorId,
            action: 'product.updated',
            entityType: 'product',
            entityId: id,
            summary: change.summary,
            details: change.details,
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.sku) throw new ConflictError(SKU_TAKEN_MESSAGE(input.sku));
      throw error;
    }
    return this.getById(id, 'admin');
  }

  /** Soft delete: hidden everywhere, but sales history keeps pointing at it. */
  async delete(id: number, actorId: number): Promise<void> {
    const existing = await this.productRepository.findById(id, true);
    if (!existing) throw new NotFoundError(`Product ${id} does not exist`);

    await this.transactions.run(async (repos) => {
      await repos.products.softDelete(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'product.deleted',
        entityType: 'product',
        entityId: id,
        summary: `Deleted product ${existing.name}`,
      });
    });
  }

  private async ensureCategoryExists(categoryId: number): Promise<void> {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) throw new ValidationError(`categoryId: category ${categoryId} does not exist`);
  }

  private toProductData(input: ProductInput): ProductData {
    return {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      basePrice: input.price,
      costPrice: input.costPrice,
      imageUrl: input.imageUrl,
      sku: input.sku,
      isActive: input.isActive,
    };
  }

  private toDto(
    product: ProductRecord,
    tiers: PricingTier[],
    runningPromotions: RunningPromotion[],
    includeCost: boolean,
  ): ProductDto {
    const quantity = product.quantity_on_hand ?? 0;
    const price = toMoney(product.base_price);
    const promotion = bestPromotionFor({ id: product.id, categoryId: product.category_id }, runningPromotions);
    const reorderLevel = product.reorder_level ?? DEFAULT_REORDER_LEVEL;
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      sku: product.sku,
      imageUrl: product.image_url,
      isActive: product.is_active,
      category: { id: product.category_id, name: product.category_name },
      price,
      ...(includeCost && { costPrice: toMoneyOrNull(product.cost_price) }),
      stock: {
        quantity,
        reorderLevel,
        isInStock: quantity > 0,
        isLowStock: isLowStock(quantity, reorderLevel),
      },
      bulkPricingTiers: tiers,
      promotion: promotion && {
        id: promotion.id,
        name: promotion.name,
        percentOff: promotion.percentOff,
        endsAt: promotion.endsAt.toISOString(),
        price: discountedPrice(price, promotion.percentOff),
      },
      createdAt: product.created_at.toISOString(),
      updatedAt: product.updated_at.toISOString(),
    };
  }
}

function toSnapshot(product: ProductRecord, tiers: PricingTier[]): ProductSnapshot {
  return {
    name: product.name,
    description: product.description,
    categoryId: product.category_id,
    price: toMoney(product.base_price),
    costPrice: toMoneyOrNull(product.cost_price),
    imageUrl: product.image_url,
    sku: product.sku,
    isActive: product.is_active,
    bulkPricingTiers: tiers,
  };
}
