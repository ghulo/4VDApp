import { DEFAULT_REORDER_LEVEL, SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import type { ProductUnit, UserRole } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CategoryRepository } from '../repositories/CategoryRepository.js';
import type { PricingTierRepository } from '../repositories/PricingTierRepository.js';
import type { ProductData, ProductRecord, ProductRepository } from '../repositories/ProductRepository.js';
import type { PromotionRepository } from '../repositories/PromotionRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { countryFromBarcode } from '../utils/barcodeCountry.js';
import { hasValidCheckDigit, inStoreBarcode } from '../utils/barcodes.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { type ProductSnapshot, describeProductChanges } from './activity/describeProductChanges.js';
import { isLowStock } from './inventory/stockAlerts.js';
import { mediaIdFrom, toMoney, toMoneyOrNull } from './mappers.js';
import type { MediaService } from './MediaService.js';
import { type PricingTier, validatePricingTiers } from './pricing/bulkPricing.js';
import { bestPromotionFor, discountedPrice, type RunningPromotion } from './pricing/promotions.js';
import { canOversee } from '../utils/roles.js';
import { DEFAULT_VAT_RATE } from './documents/vat.js';
import type { Say } from '../i18n/activityText.js';

export interface ProductDto {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  /** The main barcode, the one labels print. */
  barcode: string | null;
  /** More barcodes the same product comes under; each one finds it when scanned. */
  otherBarcodes: string[];
  imageUrl: string | null;
  isActive: boolean;
  /** Percent of VAT included in the price. */
  vatRate: number;
  /** Exempt from VAT (its rate is 0). */
  vatExempt: boolean;
  /** ISO code of the country it comes from, or null when unknown. */
  originCountry: string | null;
  category: { id: number; name: string };
  price: number;
  /** What a business pays, with VAT; null: the shelf price. */
  wholesalePrice: number | null;
  /** Only included for admins. */
  costPrice?: number | null;
  /** Sold by the piece, or by the kilo (prices per kg, quantities to the gram). */
  unit: ProductUnit;
  /** The number the shop scale prints in its labels. */
  scalePlu: number | null;
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
  /** Left out keeps the current rate (the default for a new product). */
  vatRate?: number;
  /** Exempt from VAT; only with a 0% rate. Left out keeps it while the rate stays 0. */
  vatExempt?: boolean;
  /** Left out keeps the current country (none for a new product). */
  originCountry?: string | null;
  /** What a business pays, with VAT; null: the shelf price. Left out keeps it. */
  wholesalePrice?: number | null;
  /** Replaces every tier when given; leaves them unchanged when undefined (updates only). */
  bulkPricingTiers?: PricingTier[];
  /** Left out keeps it (by the piece for a new product). */
  unit?: ProductUnit;
  /** The scale's number; left out keeps it. Only a kilo product has one. */
  scalePlu?: number | null;
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
const PLU_TAKEN_MESSAGE = (plu: number) => `Another product already has scale number ${plu}`;

/** Which product field a unique violation is about. */
function takenError(error: unknown, input: ProductInput): ConflictError | null {
  if (isUniqueViolation(error, 'products_scale_plu_unique') && input.scalePlu) return new ConflictError(PLU_TAKEN_MESSAGE(input.scalePlu));
  if (isUniqueViolation(error) && input.sku) return new ConflictError(SKU_TAKEN_MESSAGE(input.sku));
  return null;
}

export class ProductService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly pricingTierRepository: PricingTierRepository,
    private readonly promotionRepository: PromotionRepository,
    private readonly transactions: TransactionManager,
    private readonly mediaService: MediaService,
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

  /**
   * Every product on sale with its stock, deals and barcodes, in one answer,
   * for the Counter to scan against without asking again. No costs: the till
   * never shows them.
   */
  async shelf(): Promise<ProductDto[]> {
    const products = await this.productRepository.findShelf();
    const [tiersByProduct, promotions] = await Promise.all([
      this.pricingTierRepository.findByProductIds(products.map((product) => product.id)),
      this.promotionRepository.findRunning(new Date()),
    ]);
    return products.map((product) => this.toDto(product, tiersByProduct.get(product.id) ?? [], promotions, false));
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

  /** The product a scanned barcode belongs to. */
  async getByBarcode(barcode: string, viewerRole: UserRole | undefined): Promise<ProductDto> {
    const id = await this.productRepository.findIdByBarcode(barcode);
    if (!id) throw new NotFoundError(`No product has the barcode ${barcode}`);
    return this.getById(id, viewerRole);
  }

  /** Sets (or clears, with null) a product's barcode, usually the manufacturer's. */
  async setBarcode(id: number, barcode: string | null, actorId: number, logExtra?: Record<string, unknown>): Promise<ProductDto> {
    if (barcode !== null && !hasValidCheckDigit(barcode)) {
      throw new ValidationError(`${barcode} isn't a valid barcode: its last digit doesn't match. Scan it again or check for a typo.`);
    }
    const product = await this.productRepository.findById(id, true);
    if (!product) throw new NotFoundError(`Product ${id} does not exist`);
    if (barcode !== null) {
      const owner = await this.productRepository.findIdByBarcode(barcode);
      if (owner !== undefined && owner !== id) throw new ConflictError(`Another product already has the barcode ${barcode}`);
    }
    await this.transactions.run((repos) =>
      setProductBarcode(repos, {
        product,
        to: barcode,
        actorId,
        say: barcode === null ? { key: 'barcodeRemoved', params: { product: product.name } } : { key: 'barcodeSet', params: { product: product.name, to: barcode } },
        logExtra,
      }),
    );
    return this.getById(id, 'admin');
  }

  /**
   * Gives the product another barcode, for when the same item comes under more
   * than one. A product with no barcode yet takes it as its main one.
   */
  async addBarcode(id: number, barcode: string, actorId: number): Promise<ProductDto> {
    if (!hasValidCheckDigit(barcode)) {
      throw new ValidationError(`${barcode} isn't a valid barcode: its last digit doesn't match. Scan it again or check for a typo.`);
    }
    const product = await this.productRepository.findById(id, true);
    if (!product) throw new NotFoundError(`Product ${id} does not exist`);
    if (!product.barcode) return this.setBarcode(id, barcode, actorId);
    const owner = await this.productRepository.findIdByBarcode(barcode);
    if (owner === id) throw new ConflictError(`${product.name} already has the barcode ${barcode}`);
    if (owner !== undefined) throw new ConflictError(`Another product already has the barcode ${barcode}`);
    await this.transactions.run((repos) =>
      addProductBarcode(repos, { product, code: barcode, actorId, say: { key: 'barcodeAdded', params: { product: product.name, code: barcode } } }),
    );
    return this.getById(id, 'admin');
  }

  /** Takes one of the product's other barcodes off it (the main one goes with setBarcode). */
  async removeBarcode(id: number, barcode: string, actorId: number): Promise<ProductDto> {
    const product = await this.productRepository.findById(id, true);
    if (!product) throw new NotFoundError(`Product ${id} does not exist`);
    await this.transactions.run(async (repos) => {
      if (!(await repos.products.removeOtherBarcode(id, barcode))) throw new NotFoundError(`${product.name} has no other barcode ${barcode}`);
      await repos.activityLog.create({
        userId: actorId,
        action: 'product.barcode_removed',
        entityType: 'product',
        entityId: id,
        say: { key: 'otherBarcodeRemoved', params: { product: product.name, code: barcode } },
        details: { otherBarcode: barcode },
      });
    });
    return this.getById(id, 'admin');
  }

  /**
   * Sets the product's photo from an uploaded picture (from a phone camera or a
   * computer), or removes it with null. A replaced upload is deleted.
   */
  async setImage(id: number, upload: Buffer | null, actorId: number): Promise<ProductDto> {
    const product = await this.productRepository.findById(id, true);
    if (!product) throw new NotFoundError(`Product ${id} does not exist`);
    const mediaId = upload ? await this.mediaService.store(null, upload, 'product') : null;
    const imageUrl = mediaId ? `/api/media/${mediaId}` : null;
    await this.transactions.run(async (repos) => {
      await repos.products.setImageUrl(id, imageUrl);
      await repos.activityLog.create({
        userId: actorId,
        action: 'product.image_set',
        entityType: 'product',
        entityId: id,
        say: imageUrl ? { key: 'photoChanged', params: { product: product.name } } : { key: 'photoRemoved', params: { product: product.name } },
      });
    });
    await this.mediaService.remove(mediaIdFrom(product.image_url));
    return this.getById(id, 'admin');
  }

  /** Makes a shop barcode for a product that has none, so it can be labelled and scanned. */
  async createBarcode(id: number, actorId: number): Promise<ProductDto> {
    const product = await this.productRepository.findById(id, true);
    if (!product) throw new NotFoundError(`Product ${id} does not exist`);
    if (product.barcode) throw new ConflictError(`${product.name} already has a barcode`);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const barcode = inStoreBarcode(id, attempt);
      if ((await this.productRepository.findIdByBarcode(barcode)) === undefined) return this.setBarcode(id, barcode, actorId);
    }
    throw new ConflictError('Could not make a free barcode for this product');
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
  /** `logExtra` is added to the logged details (an approved request names who asked). */
  async create(input: NewProductInput, createdBy: number, logExtra?: Record<string, unknown>): Promise<ProductDto> {
    await this.ensureCategoryExists(input.categoryId);
    if (input.unit !== 'kg' && !Number.isInteger(input.stock)) throw new ValidationError(`stock: ${input.name} is sold by the piece, so its stock is a whole number`);
    const tiers = validatePricingTiers(input.price, input.bulkPricingTiers ?? []);

    try {
      const productId = await this.transactions.run(async (repos) => {
        const id = await repos.products.create(this.toProductData(input, input.vatRate ?? DEFAULT_VAT_RATE, input.vatRate === 0 && Boolean(input.vatExempt), input.originCountry ?? null));
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
          say: { key: 'productAdded', params: { name: input.name } },
          details: { price: input.price, costPrice: input.costPrice, stock: input.stock, ...logExtra },
        });
        return id;
      });
      return this.getById(productId, 'admin');
    } catch (error) {
      throw takenError(error, input) ?? error;
    }
  }

  /**
   * Full update. Stock is deliberately not editable here; use the inventory endpoint.
   * `logExtra` is added to the logged details (an undo marks its own change with it).
   */
  async update(id: number, input: ProductInput, actorId: number, logExtra?: Record<string, unknown>): Promise<ProductDto> {
    const existing = await this.productRepository.findById(id, true);
    if (!existing) throw new NotFoundError(`Product ${id} does not exist`);
    await this.ensureCategoryExists(input.categoryId);
    if (input.unit === 'piece' && existing.unit === 'kg' && !Number.isInteger(existing.quantity_on_hand ?? 0)) {
      throw new ValidationError(`${existing.name} has ${existing.quantity_on_hand} kg in stock; count it to whole pieces before selling it by the piece`);
    }

    const existingTiers = await this.pricingTierRepository.findByProductId(id);
    // If the price changed but tiers were not sent, the existing tiers must
    // still be valid against the new price.
    const tiers = validatePricingTiers(input.price, input.bulkPricingTiers ?? existingTiers);
    const vatRate = input.vatRate ?? existing.vat_rate;
    const vatExempt = vatRate === 0 && (input.vatExempt ?? (input.vatRate === undefined || input.vatRate === existing.vat_rate ? existing.vat_exempt : false));
    const originCountry = input.originCountry === undefined ? existing.origin_country : input.originCountry;
    const change = describeProductChanges(toSnapshot(existing, existingTiers), {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      price: input.price,
      costPrice: input.costPrice,
      imageUrl: input.imageUrl,
      sku: input.sku,
      isActive: input.isActive,
      vatRate,
      vatExempt,
      originCountry,
      bulkPricingTiers: input.bulkPricingTiers ? tiers : undefined,
    });

    try {
      await this.transactions.run(async (repos) => {
        await repos.products.update(id, this.toProductData(input, vatRate, vatExempt, originCountry));
        if (input.bulkPricingTiers) await repos.pricingTiers.replaceForProduct(id, tiers);
        if (change) {
          await repos.activityLog.create({
            userId: actorId,
            action: 'product.updated',
            entityType: 'product',
            entityId: id,
            say: change.say,
            details: { ...change.details, ...logExtra },
          });
        }
      });
    } catch (error) {
      throw takenError(error, input) ?? error;
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
        say: { key: 'productDeleted', params: { name: existing.name } },
      });
    });
  }

  private async ensureCategoryExists(categoryId: number): Promise<void> {
    const category = await this.categoryRepository.findById(categoryId);
    if (!category) throw new ValidationError(`categoryId: category ${categoryId} does not exist`);
  }

  private toProductData(input: ProductInput, vatRate: number, vatExempt: boolean, originCountry: string | null): ProductData {
    return {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      basePrice: input.price,
      costPrice: input.costPrice,
      imageUrl: input.imageUrl,
      sku: input.sku,
      isActive: input.isActive,
      vatRate,
      vatExempt,
      originCountry,
      wholesalePrice: input.wholesalePrice,
      unit: input.unit,
      // A product sold by the piece is never weighed on the scale.
      scalePlu: input.unit === 'piece' ? null : input.scalePlu,
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
      barcode: product.barcode,
      otherBarcodes: product.other_barcodes,
      imageUrl: product.image_url,
      isActive: product.is_active,
      vatRate: product.vat_rate,
      vatExempt: product.vat_exempt,
      originCountry: product.origin_country,
      category: { id: product.category_id, name: product.category_name },
      price,
      wholesalePrice: toMoneyOrNull(product.wholesale_price),
      unit: product.unit,
      scalePlu: product.scale_plu,
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
    vatRate: product.vat_rate,
    vatExempt: product.vat_exempt,
    originCountry: product.origin_country,
    bulkPricingTiers: tiers,
  };
}

/**
 * Every barcode change goes through here (the product page, scanned bills and
 * their reopening), so each one is in the product's history. A product with no
 * country yet takes the one the new barcode was registered in. Run inside a
 * transaction; the caller checks the barcode is free.
 */
export async function setProductBarcode(
  repos: TransactionalRepositories,
  p: {
    product: { id: number; barcode: string | null; origin_country: string | null };
    to: string | null;
    actorId: number;
    say: Say;
    logExtra?: Record<string, unknown>;
  },
): Promise<void> {
  const { product } = p;
  // One of its other barcodes becoming the main one swaps places with the old main one.
  const promoted = p.to !== null && (await repos.products.removeOtherBarcode(product.id, p.to));
  await repos.products.setBarcode(product.id, p.to);
  if (promoted && product.barcode) await repos.products.addOtherBarcode(product.id, product.barcode, p.actorId);
  const country = product.origin_country ? null : countryFromBarcode(p.to);
  if (country) await repos.products.setOriginCountry(product.id, country);
  await repos.activityLog.create({
    userId: p.actorId,
    action: 'product.barcode_set',
    entityType: 'product',
    entityId: product.id,
    say: p.say,
    details: { barcode: { from: product.barcode, to: p.to }, ...(country && { originCountry: { from: null, to: country } }), ...p.logExtra },
  });
}

/**
 * Gives a product another barcode (the product page and scanned bills). A
 * product with no country yet takes the one the barcode was registered in.
 * Run inside a transaction; the caller checks the barcode is free.
 */
export async function addProductBarcode(
  repos: TransactionalRepositories,
  p: { product: { id: number; origin_country: string | null }; code: string; actorId: number; say: Say; logExtra?: Record<string, unknown> },
): Promise<void> {
  await repos.products.addOtherBarcode(p.product.id, p.code, p.actorId);
  const country = p.product.origin_country ? null : countryFromBarcode(p.code);
  if (country) await repos.products.setOriginCountry(p.product.id, country);
  await repos.activityLog.create({
    userId: p.actorId,
    action: 'product.barcode_added',
    entityType: 'product',
    entityId: p.product.id,
    say: p.say,
    details: { otherBarcode: p.code, ...(country && { originCountry: { from: null, to: country } }), ...p.logExtra },
  });
}
