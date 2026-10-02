import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { PromotionRecord, PromotionRepository } from '../repositories/PromotionRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro } from '../utils/money.js';
import { discountedPrice, minimumPrice } from './pricing/promotions.js';
import type { SettingsService } from './SettingsService.js';

export type PromotionStatus = 'scheduled' | 'running' | 'finished' | 'ended';

export interface PromotionDto {
  id: number;
  name: string;
  percentOff: number;
  product: { id: number; name: string } | null;
  category: { id: number; name: string } | null;
  startsAt: string;
  /** End-exclusive: a promotion "until 7 Oct" ends at the start of 8 Oct. */
  endsAt: string;
  endedEarlyAt: string | null;
  status: PromotionStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface NewPromotionInput {
  name: string;
  percentOff: number;
  productId?: number;
  categoryId?: number;
  startsAt: Date;
  endsAt: Date;
}

export class PromotionService {
  constructor(
    private readonly promotionRepository: PromotionRepository,
    private readonly settingsService: SettingsService,
    private readonly transactions: TransactionManager,
  ) {}

  async list(): Promise<PromotionDto[]> {
    const now = new Date();
    return (await this.promotionRepository.findAll()).map((row) => toPromotionDto(row, now));
  }

  /**
   * Refused when it would put any covered product below cost plus the
   * minimum margin, naming those products so the owner can pick a smaller
   * discount or leave them out.
   */
  async create(input: NewPromotionInput, createdBy: number): Promise<PromotionDto> {
    if ((input.productId === undefined) === (input.categoryId === undefined)) {
      throw new ValidationError('Choose either one product or one category');
    }
    if (input.endsAt <= input.startsAt) throw new ValidationError('The end date must be on or after the start date');

    const target = { productId: input.productId ?? null, categoryId: input.categoryId ?? null };
    const products = await this.promotionRepository.coveredProducts(target);
    if (products.length === 0) {
      throw new ValidationError(input.productId ? 'That product does not exist' : 'That category has no products');
    }

    const { minimumMarginPercent } = await this.settingsService.get();
    const tooLow = products.filter((product) => {
      if (product.cost_price === null) return false;
      const newPrice = discountedPrice(Number(product.base_price), input.percentOff);
      return newPrice < minimumPrice(Number(product.cost_price), minimumMarginPercent);
    });
    if (tooLow.length > 0) {
      const names = tooLow
        .map((product) => `${product.name} (would be ${formatEuro(discountedPrice(Number(product.base_price), input.percentOff))}, lowest allowed ${formatEuro(minimumPrice(Number(product.cost_price), minimumMarginPercent))})`)
        .join(', ');
      throw new ValidationError(`${input.percentOff}% off is too much for: ${names}`);
    }

    const id = await this.transactions.run(async (repos) => {
      const promotionId = await repos.promotions.create({
        name: input.name,
        percentOff: input.percentOff,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ...target,
        createdBy,
      });
      await repos.activityLog.create({
        userId: createdBy,
        action: 'promotion.created',
        entityType: 'promotion',
        entityId: promotionId,
        summary: `Started promotion "${input.name}": ${input.percentOff}% off ${input.productId ? products[0]!.name : `${products.length} products`}`,
        details: { percentOff: input.percentOff, ...target, startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return promotionId;
    });
    return toPromotionDto((await this.promotionRepository.findById(id))!, new Date());
  }

  async endEarly(id: number, actorId: number): Promise<PromotionDto> {
    const existing = await this.promotionRepository.findById(id);
    if (!existing) throw new NotFoundError(`Promotion ${id} does not exist`);
    const now = new Date();
    const status = promotionStatus(existing, now);
    if (status === 'finished' || status === 'ended') throw new ConflictError('This promotion has already ended');

    await this.transactions.run(async (repos) => {
      await repos.promotions.endEarly(id, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'promotion.ended',
        entityType: 'promotion',
        entityId: id,
        summary: status === 'scheduled' ? `Cancelled promotion "${existing.name}"` : `Ended promotion "${existing.name}" early`,
      });
    });
    return toPromotionDto((await this.promotionRepository.findById(id))!, now);
  }
}

function promotionStatus(row: PromotionRecord, now: Date): PromotionStatus {
  if (row.ended_early_at && row.ended_early_at <= now) return 'ended';
  if (row.ends_at <= now) return 'finished';
  if (row.starts_at > now) return 'scheduled';
  return 'running';
}

function toPromotionDto(row: PromotionRecord, now: Date): PromotionDto {
  return {
    id: row.id,
    name: row.name,
    percentOff: Number(row.percent_off),
    product: row.product_id === null ? null : { id: row.product_id, name: row.product_name ?? '' },
    category: row.category_id === null ? null : { id: row.category_id, name: row.category_name ?? '' },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    endedEarlyAt: row.ended_early_at?.toISOString() ?? null,
    status: promotionStatus(row, now),
    createdBy: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}
