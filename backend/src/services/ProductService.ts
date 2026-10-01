import { DEFAULT_REORDER_LEVEL, SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import type { UserRole } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CategoryRepository } from '../repositories/CategoryRepository.js';
import type { PricingTierRepository } from '../repositories/PricingTierRepository.js';
import type { ProductData, ProductRecord, ProductRepository } from '../repositories/ProductRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { isLowStock } from './inventory/stockAlerts.js';
import { toMoney, toMoneyOrNull } from './mappers.js';
import { type PricingTier, validatePricingTiers } from './pricing/bulkPricing.js';

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
    private readonly transactions: TransactionManager,
  ) {}

  async list(query: ProductQuery, viewerRole: UserRole | undefined): Promise<Paginated<ProductDto>> {
    const isAdmin = viewerRole === 'admin';
    const { products, total } = await this.productRepository.findMany({
      categoryId: query.categoryId,
      search: query.search,
      inStock: query.inStock,
      includeInactive: isAdmin,
      limit: query.limit,
      offset: toOffset(query),
    });
    const tiersByProduct = await this.pricingTierRepository.findByProductIds(products.map((product) => product.id));

    return {
      items: products.map((product) => this.toDto(product, tiersByProduct.get(product.id) ?? [], isAdmin)),
      meta: toPaginationMeta(query, total),
    };
  }

  async getById(id: number, viewerRole: UserRole | undefined): Promise<ProductDto> {
    const isAdmin = viewerRole === 'admin';
    const product = await this.productRepository.findById(id, isAdmin);
    if (!product) throw new NotFoundError(`Product ${id} does not exist`);
    const tiers = await this.pricingTierRepository.findByProductId(id);
    return this.toDto(product, tiers, isAdmin);
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
        return id;
      });
      return this.getById(productId, 'admin');
    } catch (error) {
      if (isUniqueViolation(error) && input.sku) throw new ConflictError(SKU_TAKEN_MESSAGE(input.sku));
      throw error;
    }
  }

  /** Full update. Stock is deliberately not editable here; use the inventory endpoint. */
  async update(id: number, input: ProductInput): Promise<ProductDto> {
    if (!(await this.productRepository.exists(id))) throw new NotFoundError(`Product ${id} does not exist`);
    await this.ensureCategoryExists(input.categoryId);

    // If the price changed but tiers were not sent, the existing tiers must
    // still be valid against the new price.
    const tiersToCheck = input.bulkPricingTiers ?? (await this.pricingTierRepository.findByProductId(id));
    const tiers = validatePricingTiers(input.price, tiersToCheck);

    try {
      await this.transactions.run(async (repos) => {
        await repos.products.update(id, this.toProductData(input));
        if (input.bulkPricingTiers) await repos.pricingTiers.replaceForProduct(id, tiers);
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.sku) throw new ConflictError(SKU_TAKEN_MESSAGE(input.sku));
      throw error;
    }
    return this.getById(id, 'admin');
  }

  /** Soft delete: hidden everywhere, but sales history keeps pointing at it. */
  async delete(id: number): Promise<void> {
    const wasDeleted = await this.productRepository.softDelete(id);
    if (!wasDeleted) throw new NotFoundError(`Product ${id} does not exist`);
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

  private toDto(product: ProductRecord, tiers: PricingTier[], includeCost: boolean): ProductDto {
    const quantity = product.quantity_on_hand ?? 0;
    const reorderLevel = product.reorder_level ?? DEFAULT_REORDER_LEVEL;
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      sku: product.sku,
      imageUrl: product.image_url,
      isActive: product.is_active,
      category: { id: product.category_id, name: product.category_name },
      price: toMoney(product.base_price),
      ...(includeCost && { costPrice: toMoneyOrNull(product.cost_price) }),
      stock: {
        quantity,
        reorderLevel,
        isInStock: quantity > 0,
        isLowStock: isLowStock(quantity, reorderLevel),
      },
      bulkPricingTiers: tiers,
      createdAt: product.created_at.toISOString(),
      updatedAt: product.updated_at.toISOString(),
    };
  }
}
