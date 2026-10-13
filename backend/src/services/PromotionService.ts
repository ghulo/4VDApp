import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { PromotionRecord, PromotionRepository, PromotionSales, PromotionTarget } from '../repositories/PromotionRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { addDays, startOfDay, zonedDay } from '../utils/zonedDates.js';
import { discountedPrice, minimumPrice } from './pricing/promotions.js';
import type { SettingsService } from './SettingsService.js';

export type PromotionStatus = 'scheduled' | 'running' | 'finished' | 'ended';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  /** What sold at its price so far. */
  sold: PromotionSales;
}

export interface NewPromotionInput {
  name: string;
  percentOff: number;
  productId?: number;
  categoryId?: number;
  startsAt: Date;
  endsAt: Date;
}

/** One product a promotion would cover, at the new price, and whether the minimum margin allows it. */
export interface PromotionPreviewLine {
  id: number;
  name: string;
  price: number;
  newPrice: number;
  cost: number | null;
  /** Cost plus the minimum margin; null when the cost is unknown. */
  lowestAllowed: number | null;
  /** New price less cost, per piece; null when the cost is unknown. */
  profitEach: number | null;
  tooLow: boolean;
}

/** How a promotion did: its own sales, and everything it covers during it against the same number of days before. */
export interface PromotionResultsDto {
  promotion: PromotionDto;
  /** Days it has run (or ran), at least 1. */
  days: number;
  during: { pieces: number; revenue: number };
  before: { pieces: number; revenue: number };
  /** Shop days from the start of the "before" stretch to the last day it ran; `during` marks the promotion's days. */
  daily: Array<{ day: string; pieces: number; revenue: number; during: boolean }>;
}

const NOTHING_SOLD: PromotionSales = { pieces: 0, revenue: 0, discount: 0, profit: 0 };

export class PromotionService {
  constructor(
    private readonly promotionRepository: PromotionRepository,
    private readonly settingsService: SettingsService,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async list(): Promise<PromotionDto[]> {
    const now = new Date();
    const [rows, sold] = await Promise.all([this.promotionRepository.findAll(), this.promotionRepository.salesTotals()]);
    return rows.map((row) => toPromotionDto(row, now, sold.get(row.id)));
  }

  /** Sold at promotion prices this calendar month (shop clock), all promotions together. */
  async monthSummary(now = new Date()): Promise<PromotionSales> {
    const monthStart = startOfDay(`${zonedDay(now, this.timeZone).slice(0, 7)}-01`, this.timeZone);
    const totals = [...(await this.promotionRepository.salesTotals({ from: monthStart })).values()];
    return roundSales(
      totals.reduce(
        (sum, row) => ({ pieces: sum.pieces + row.pieces, revenue: sum.revenue + row.revenue, discount: sum.discount + row.discount, profit: sum.profit + row.profit }),
        NOTHING_SOLD,
      ),
    );
  }

  async results(id: number, now = new Date()): Promise<PromotionResultsDto> {
    const row = await this.promotionRepository.findById(id);
    if (!row) throw new NotFoundError(`Promotion ${id} does not exist`);
    const sold = await this.promotionRepository.salesTotals({ promotionId: id });
    const promotion = toPromotionDto(row, now, sold.get(id));

    const start = row.starts_at;
    const stoppedAt = [row.ends_at, row.ended_early_at ?? row.ends_at, now].reduce((earliest, date) => (date < earliest ? date : earliest));
    const days = Math.max(1, Math.ceil((stoppedAt.getTime() - start.getTime()) / MS_PER_DAY));
    const beforeStart = new Date(start.getTime() - days * MS_PER_DAY);
    const end = stoppedAt > start ? stoppedAt : start;
    const target = { productId: row.product_id, categoryId: row.category_id };
    const byDay = new Map((await this.promotionRepository.coveredSalesByDay(target, beforeStart, end, this.timeZone)).map((entry) => [entry.day, entry]));

    const firstDay = zonedDay(beforeStart, this.timeZone);
    const startDay = zonedDay(start, this.timeZone);
    const lastDay = zonedDay(new Date(Math.max(end.getTime() - 1, start.getTime())), this.timeZone);
    const daily: PromotionResultsDto['daily'] = [];
    for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
      const entry = byDay.get(day);
      daily.push({ day, pieces: entry?.pieces ?? 0, revenue: roundMoney(entry?.revenue ?? 0), during: day >= startDay && end > start });
    }
    const total = (during: boolean) => {
      const own = daily.filter((entry) => entry.during === during);
      return { pieces: own.reduce((sum, entry) => sum + entry.pieces, 0), revenue: roundMoney(own.reduce((sum, entry) => sum + entry.revenue, 0)) };
    };
    return { promotion, days, during: total(true), before: total(false), daily };
  }

  /** Every product the promotion would cover at the new price, so the owner sees what it does before starting it. */
  async preview(input: { percentOff: number } & Partial<PromotionTarget>): Promise<PromotionPreviewLine[]> {
    const target = this.target(input);
    const products = await this.promotionRepository.coveredProducts(target);
    const { minimumMarginPercent } = await this.settingsService.get();
    return products.map((product) => {
      const price = Number(product.base_price);
      const cost = product.cost_price === null ? null : Number(product.cost_price);
      const newPrice = discountedPrice(price, input.percentOff);
      const lowestAllowed = cost === null ? null : minimumPrice(cost, minimumMarginPercent);
      return {
        id: product.id,
        name: product.name,
        price,
        newPrice,
        cost,
        lowestAllowed,
        profitEach: cost === null ? null : roundMoney(newPrice - cost),
        tooLow: lowestAllowed !== null && newPrice < lowestAllowed,
      };
    });
  }

  /**
   * Refused when it would put any covered product below cost plus the
   * minimum margin, naming those products so the owner can pick a smaller
   * discount or leave them out.
   */
  async create(input: NewPromotionInput, createdBy: number): Promise<PromotionDto> {
    const target = this.target(input);
    if (input.endsAt <= input.startsAt) throw new ValidationError('The end date must be on or after the start date');

    const products = await this.preview({ percentOff: input.percentOff, ...target });
    if (products.length === 0) {
      throw new ValidationError(input.productId ? 'That product does not exist' : 'That category has no products');
    }
    const tooLow = products.filter((product) => product.tooLow);
    if (tooLow.length > 0) {
      const names = tooLow
        .map((product) => `${product.name} (would be ${formatEuro(product.newPrice)}, lowest allowed ${formatEuro(product.lowestAllowed!)})`)
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
        say: { key: 'promotionStarted', params: { name: input.name, percent: input.percentOff, product: input.productId ? products[0]!.name : null, products: products.length } },
        details: { percentOff: input.percentOff, ...target, startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return promotionId;
    });
    return toPromotionDto((await this.promotionRepository.findById(id))!, new Date());
  }

  async endEarly(id: number, actorId: number, logExtra?: Record<string, unknown>): Promise<PromotionDto> {
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
        say: status === 'scheduled' ? { key: 'promotionCancelled', params: { name: existing.name } } : { key: 'promotionEnded', params: { name: existing.name } },
        details: logExtra ?? null,
      });
    });
    const sold = await this.promotionRepository.salesTotals({ promotionId: id });
    return toPromotionDto((await this.promotionRepository.findById(id))!, now, sold.get(id));
  }

  /** Exactly one of a product or a category. */
  private target(input: Partial<PromotionTarget>): PromotionTarget {
    const productId = input.productId ?? null;
    const categoryId = input.categoryId ?? null;
    if ((productId === null) === (categoryId === null)) throw new ValidationError('Choose either one product or one category');
    return { productId, categoryId };
  }
}

function promotionStatus(row: PromotionRecord, now: Date): PromotionStatus {
  if (row.ended_early_at && row.ended_early_at <= now) return 'ended';
  if (row.ends_at <= now) return 'finished';
  if (row.starts_at > now) return 'scheduled';
  return 'running';
}

const roundSales = (sales: PromotionSales): PromotionSales => ({
  pieces: sales.pieces,
  revenue: roundMoney(sales.revenue),
  discount: roundMoney(sales.discount),
  profit: roundMoney(sales.profit),
});

function toPromotionDto(row: PromotionRecord, now: Date, sold: PromotionSales = NOTHING_SOLD): PromotionDto {
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
    sold: roundSales(sold),
  };
}
