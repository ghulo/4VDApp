import { ConflictError, NotFoundError } from '../errors/httpErrors.js';
import type { ExpiryRecord, ExpiryRepository } from '../repositories/ExpiryRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { zonedDay } from '../utils/zonedDates.js';

/** Expiry dates this close show up in "Needs your attention". */
export const EXPIRY_WARNING_DAYS = 7;
/** This close (or already past) they're urgent. */
export const EXPIRY_URGENT_DAYS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ExpiryDto {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  expiresOn: string;
  /** Days from today in shop time; negative once it has passed. */
  daysLeft: number;
  note: string | null;
  addedBy: string | null;
}

/** Whole days from `today` to `day`, both "YYYY-MM-DD". */
const daysBetween = (today: string, day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY);

/** Notes of when stock expires, so it's sold or written off in time. */
export class ExpiryService {
  constructor(
    private readonly expiryRepository: ExpiryRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  private toDto(row: ExpiryRecord, today: string): ExpiryDto {
    return {
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      quantity: row.quantity,
      expiresOn: row.expires_on,
      daysLeft: daysBetween(today, row.expires_on),
      note: row.note,
      addedBy: row.created_by_name,
    };
  }

  async forProduct(productId: number, now = new Date()): Promise<ExpiryDto[]> {
    const today = zonedDay(now, this.timeZone);
    return (await this.expiryRepository.findOpen({ productId })).map((row) => this.toDto(row, today));
  }

  /** Everything expiring within `days` (or already expired), soonest first. */
  async upcoming(days = EXPIRY_WARNING_DAYS, now = new Date()): Promise<ExpiryDto[]> {
    const today = zonedDay(now, this.timeZone);
    const until = new Date(Date.parse(`${today}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
    return (await this.expiryRepository.findOpen({ until })).map((row) => this.toDto(row, today));
  }

  async add(input: { productId: number; quantity: number; expiresOn: string; note: string | null }, actorId: number): Promise<ExpiryDto> {
    const id = await this.transactions.run(async (repos) => {
      const product = await repos.products.findById(input.productId, true);
      if (!product) throw new NotFoundError(`Product ${input.productId} does not exist`);
      const expiryId = await repos.expiry.add({ ...input, orderLineId: null, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'expiry.added',
        entityType: 'product',
        entityId: product.id,
        summary: `Noted ${input.quantity} × ${product.name} expiring on ${input.expiresOn}`,
        details: { ...input },
      });
      return expiryId;
    });
    return this.toDto((await this.expiryRepository.findById(id))!, zonedDay(new Date(), this.timeZone));
  }

  /** Marks it dealt with: sold, written off, or checked and fine. */
  async clear(id: number, actorId: number, now = new Date()): Promise<void> {
    const row = await this.expiryRepository.findById(id);
    if (!row) throw new NotFoundError(`Expiry date ${id} does not exist`);
    if (row.cleared_at) throw new ConflictError('This was already marked as dealt with');
    await this.transactions.run(async (repos) => {
      await repos.expiry.clear(id, actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'expiry.cleared',
        entityType: 'product',
        entityId: row.product_id,
        summary: `Dealt with ${row.quantity} × ${row.product_name} expiring on ${row.expires_on}`,
        details: { expiryId: id },
      });
    });
  }
}
