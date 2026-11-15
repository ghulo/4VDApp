import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { ExpiryRecord, ExpiryRepository } from '../repositories/ExpiryRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { PublicUser } from '../types/auth.js';
import { roundMoney } from '../utils/money.js';
import { addDays, zonedDay } from '../utils/zonedDates.js';
import { daysBetween, type ShortDatedRules, shortDatedPercent, shortDatedPrice, shortDatedWindow } from './pricing/shortDated.js';
import type { SettingsService } from './SettingsService.js';
import type { WriteOffService } from './WriteOffService.js';

/** Expiry dates this close show up in "Needs your attention". */
export const EXPIRY_WARNING_DAYS = 7;
/** This close (or already past) they're urgent. */
export const EXPIRY_URGENT_DAYS = 2;

export interface ExpiryDto {
  id: number;
  productId: number;
  productName: string;
  /** Units noted when the date was added. */
  quantity: number;
  /** How many of them are probably still on the shelf (see `batchesLeft`). */
  remaining: number;
  expiresOn: string;
  /** Days from today in shop time; negative once it has passed. */
  daysLeft: number;
  note: string | null;
  addedBy: string | null;
  /** Cost of one unit (with VAT), when known. */
  costEach: number | null;
  /** What is left is worth this at cost; null when the cost is unknown. */
  valueAtCost: number | null;
  /** Shelf price of one unit. */
  price: number;
  /** Today's short-dated price for a stickered unit, or null when it isn't short-dated (yet, or any more). */
  shortDated: { percentOff: number; price: number } | null;
}

/**
 * Sales, write-offs and counts take units off the shelf without touching the
 * dates, so a date can outlive its stock. Stock sells oldest first, so what
 * is missing from the noted total comes off the soonest dates first; a date
 * with nothing left is dropped, and one partly sold shows what is left.
 * Units sold at a batch's short-dated price always come off that batch, so
 * its discount stops once they are gone, even when undated stock (never
 * noted) makes the shelf look fuller than the dates.
 */
export function batchesLeft(rows: ExpiryRecord[]): Array<{ row: ExpiryRecord; remaining: number }> {
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
    const remaining = Math.max(0, Math.min(row.quantity - take, Math.floor(row.quantity - row.sold_short)));
    if (remaining > 0) result.push({ row, remaining });
  }
  return result;
}

/** Today's short-dated price for one unit of this batch, or null when it isn't short-dated. */
export function shortDatedOffer(row: ExpiryRecord, today: string, rules: ShortDatedRules): { percentOff: number; price: number } | null {
  const window = shortDatedWindow(row.product_short_days, row.category_short_days, rules);
  const percent = shortDatedPercent(daysBetween(today, row.expires_on), window, rules.steps);
  if (percent === null) return null;
  const shelf = Number(row.base_price);
  const offer = shortDatedPrice(shelf, percent, row.cost_price === null ? null : Number(row.cost_price), rules.belowCost);
  return offer.price < shelf ? { percentOff: offer.percent, price: offer.price } : null;
}

/** Notes of when stock expires, so it's sold (short-dated) or written off in time. */
export class ExpiryService {
  constructor(
    private readonly expiryRepository: ExpiryRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
    private readonly settings: SettingsService,
    private readonly writeOffs: WriteOffService,
  ) {}

  private toDto(row: ExpiryRecord, today: string, rules: ShortDatedRules, remaining = row.quantity): ExpiryDto {
    const costEach = row.cost_price === null ? null : Number(row.cost_price);
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
      costEach,
      valueAtCost: costEach === null ? null : roundMoney(costEach * remaining),
      price: Number(row.base_price),
      shortDated: shortDatedOffer(row, today, rules),
    };
  }

  /** Open dates for one product that still have units on the shelf, soonest first. */
  async forProduct(productId: number, now = new Date()): Promise<ExpiryDto[]> {
    const today = zonedDay(now, this.timeZone);
    const rules = (await this.settings.rules()).shortDated;
    return batchesLeft(await this.expiryRepository.findOpen({ productId })).map(({ row, remaining }) => this.toDto(row, today, rules, remaining));
  }

  /** Everything with units left that expires within `days` (or already has), soonest first. */
  async upcoming(days = EXPIRY_WARNING_DAYS, now = new Date()): Promise<ExpiryDto[]> {
    const today = zonedDay(now, this.timeZone);
    const until = addDays(today, days);
    const rules = (await this.settings.rules()).shortDated;
    return batchesLeft(await this.expiryRepository.findOpen({}))
      .filter(({ row }) => row.expires_on <= until)
      .map(({ row, remaining }) => this.toDto(row, today, rules, remaining));
  }

  /** Batches that sell at a short-dated price today, for the Counter and the Sell screen. */
  async shortDated(now = new Date()): Promise<ExpiryDto[]> {
    return (await this.upcoming(60, now)).filter((expiry) => expiry.shortDated !== null);
  }

  /** With `replace` (from a count), the product's other open dates are closed first: the shelf was just counted. */
  async add(input: { productId: number; quantity: number; expiresOn: string; note: string | null; replace?: boolean }, actorId: number): Promise<ExpiryDto> {
    const { replace, ...entry } = input;
    const id = await this.transactions.run(async (repos) => {
      const product = await repos.products.findById(entry.productId, true);
      if (!product) throw new NotFoundError(`Product ${entry.productId} does not exist`);
      if (replace) await repos.expiry.clearAllForProduct(product.id, actorId, new Date());
      const expiryId = await repos.expiry.add({ ...entry, orderLineId: null, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'expiry.added',
        entityType: 'product',
        entityId: product.id,
        say: { key: 'expiryNoted', params: { quantity: input.quantity, product: product.name, day: input.expiresOn } },
        details: { ...input },
      });
      return expiryId;
    });
    const today = zonedDay(new Date(), this.timeZone);
    return this.toDto((await this.expiryRepository.findById(id))!, today, (await this.settings.rules()).shortDated);
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
        say: { key: 'expiryCleared', params: { quantity: row.quantity, product: row.product_name, day: row.expires_on } },
        details: { expiryId: id },
      });
    });
  }

  /**
   * Writes off what is left of a batch as expired, through the usual
   * write-off (owners' apply at once and go into the books; employees' wait
   * for a yes), and marks the date dealt with.
   */
  async writeOff(id: number, user: PublicUser, now = new Date()): Promise<{ writeOffId: number; quantity: number }> {
    const row = await this.expiryRepository.findById(id);
    if (!row) throw new NotFoundError(`Expiry date ${id} does not exist`);
    if (row.cleared_at) throw new ConflictError('This was already marked as dealt with');
    const left = batchesLeft(await this.expiryRepository.findOpen({ productId: row.product_id })).find((batch) => batch.row.id === id);
    const quantity = Math.min(left?.remaining ?? 0, Math.floor(row.stock));
    if (quantity <= 0) throw new ValidationError('Nothing of this date is left on the shelf. Mark it as dealt with instead.');
    const writeOff = await this.writeOffs.request(
      { productId: row.product_id, quantity, reason: 'expired', notes: `Best before ${row.expires_on}` },
      user,
    );
    await this.transactions.run((repos) => repos.expiry.clear(id, user.id, now, writeOff.id));
    return { writeOffId: writeOff.id, quantity };
  }
}
