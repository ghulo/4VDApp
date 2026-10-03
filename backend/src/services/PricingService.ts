import { NotFoundError } from '../errors/httpErrors.js';
import type { ProductRepository } from '../repositories/ProductRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { PricingTierRepository } from '../repositories/PricingTierRepository.js';
import { toMoney } from './mappers.js';
import { type PricingTier, validatePricingTiers } from './pricing/bulkPricing.js';

export interface PricingTiersDto {
  productId: number;
  basePrice: number;
  tiers: PricingTier[];
}

export class PricingService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly pricingTierRepository: PricingTierRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async getTiers(productId: number, includeInactive: boolean): Promise<PricingTiersDto> {
    const product = await this.productRepository.findById(productId, includeInactive);
    if (!product) throw new NotFoundError(`Product ${productId} does not exist`);
    const tiers = await this.pricingTierRepository.findByProductId(productId);
    return { productId, basePrice: toMoney(product.base_price), tiers };
  }

  async replaceTiers(
    productId: number,
    tiers: PricingTier[],
    actorId: number,
    logExtra?: Record<string, unknown>,
  ): Promise<PricingTiersDto> {
    const product = await this.productRepository.findById(productId, true);
    if (!product) throw new NotFoundError(`Product ${productId} does not exist`);

    const basePrice = toMoney(product.base_price);
    const sortedTiers = validatePricingTiers(basePrice, tiers);
    const previousTiers = await this.pricingTierRepository.findByProductId(productId);

    await this.transactions.run(async (repos) => {
      await repos.pricingTiers.replaceForProduct(productId, sortedTiers);
      await repos.activityLog.create({
        userId: actorId,
        action: 'pricing.updated',
        entityType: 'product',
        entityId: productId,
        summary: `Updated bulk prices for ${product.name}`,
        details: { from: previousTiers, to: sortedTiers, ...logExtra },
      });
    });
    return { productId, basePrice, tiers: sortedTiers };
  }
}
