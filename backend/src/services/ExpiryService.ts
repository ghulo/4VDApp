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
  /** Units noted when the date was added. */
  quantity: number;
  /** How many of them are probably still on the shelf (see `stillOnShelf`). */
  remaining: number;
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

  private toDto(row: ExpiryRecord, today: string, remaining = row.quantity): ExpiryDto {
    return {
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      quantity: row.quantity,
      remaining,
      expiresOn: row.expires_on,
      daysLeft: daysBetween(today, row.expires_on),
      note: row.note,
      addedBy: row.created_by_name,
    };
  }

  /** Open dates for one product that still have units on the shelf, soonest first. */
  async forProduct(productId: number, now = new Date()): Promise<ExpiryDto[]> {
    const today = zonedDay(now, this.timeZone);
    return this.stillOnShelf(await this.expiryRepository.findOpen({ productId })).map(({ row, remaining }) => this.toDto(row, today, remaining));
  }

  /** Everything with units left that expires within `days` (or already has), soonest first. */
  async upcoming(days = EXPIRY_WARNING_DAYS, now = new Date()): Promise<ExpiryDto[]> {
    const today = zonedDay(now, this.timeZone);
    const until = new Date(Date.parse(`${today}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
    return this.stillOnShelf(await this.expiryRepository.findOpen({}))
      .filter(({ row }) => row.expires_on <= until)
      .map(({ row, remaining }) => this.toDto(row, today, remaining));
  }

  /**
   * Sales, write-offs and counts take units off the shelf without touching the
   * dates, so a date can outlive its stock. Stock sells oldest first, so what
   * is missing from the noted total comes off the soonest dates first; a date
   * with nothing left is dropped, and one partly sold shows what is left.
   * Units that were never noted only ever make this cautious: it never hides
   * units that may still be there.
   */
  private stillOnShelf(rows: ExpiryRecord[]): Array<{ row: ExpiryRecord; remaining: number }> {
    const noted = new Map<number, { total: number; stock: number }>();
    for (const row of rows) {
      const entry = noted.get(row.product_id) ?? { total: 0, stock: row.stock };
      entry.total += row.quantity;
      noted.set(row.product_id, entry);
    }
    // Units that must already be gone per product: noted minus what is on the shelf.
    const gone = new Map([...noted].map(([productId, { total, stock }]) => [productId, Math.max(0, total - stock)]));
    const result: Array<{ row: ExpiryRecord; remaining: number }> = [];
    for (const row of rows) {
      const take = Math.min(gone.get(row.product_id) ?? 0, row.quantity);
      gone.set(row.product_id, (gone.get(row.product_id) ?? 0) - take);
      if (row.quantity - take > 0) result.push({ row, remaining: row.quantity - take });
    }
    return result;
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
