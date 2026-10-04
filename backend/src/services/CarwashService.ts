import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CarwashRepository } from '../repositories/CarwashRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { DateRange } from './reports/calculations.js';

export interface CarwashTotals {
  carwash: number;
  /** What the change machine made: notes changed into coins. */
  change: number;
  /** Carwash + change. */
  total: number;
  /** How many days have takings entered. */
  days: number;
}

export interface CarwashDayDto {
  day: string;
  carwash: number;
  change: number;
  total: number;
  recordedBy: string | null;
  updatedAt: string;
}

export interface CarwashTakings {
  carwash: number;
  change: number;
}

/**
 * The carwash, the other half of 4VD SH.P.K. It has no products: someone
 * enters what it made each day, split into the wash and the change machine.
 */
export class CarwashService {
  constructor(
    private readonly carwashRepository: CarwashRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  /** The shop-time calendar days a report range covers (end-exclusive, like every report range). */
  private days(range: DateRange): { from: string; to: string } {
    return {
      from: zonedDay(range.startDate, this.timeZone),
      to: zonedDay(new Date(range.endDate.getTime() - 1), this.timeZone),
    };
  }

  async list(range: DateRange): Promise<{ days: CarwashDayDto[]; totals: CarwashTotals }> {
    const { from, to } = this.days(range);
    const [rows, totals] = await Promise.all([this.carwashRepository.findBetween(from, to), this.totals(range)]);
    return {
      days: rows.map((row) => {
        const carwash = Number(row.carwash_amount);
        const change = Number(row.change_amount);
        return {
          day: row.day,
          carwash,
          change,
          total: roundMoney(carwash + change),
          recordedBy: row.recorded_by_name,
          updatedAt: row.updated_at.toISOString(),
        };
      }),
      totals,
    };
  }

  async totals(range: DateRange): Promise<CarwashTotals> {
    const { from, to } = this.days(range);
    const row = await this.carwashRepository.totals(from, to);
    const carwash = Number(row.carwash);
    const change = Number(row.change);
    return { carwash, change, total: roundMoney(carwash + change), days: Number(row.days) };
  }

  /** What was entered for one day, or null when nothing was. */
  async findDay(day: string): Promise<CarwashTakings | null> {
    const row = await this.carwashRepository.findDay(day);
    return row ? { carwash: Number(row.carwash_amount), change: Number(row.change_amount) } : null;
  }

  /** Enters a day's takings, replacing what was entered before. */
  async save(day: string, takings: CarwashTakings, actorId: number, now = new Date()): Promise<void> {
    if (day > zonedDay(now, this.timeZone)) throw new ValidationError("You can't enter takings for a day that hasn't happened yet");
    const before = await this.carwashRepository.findDay(day);
    await this.transactions.run(async (repos) => {
      await repos.carwash.save({ day, ...takings, recordedBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'carwash.recorded',
        entityType: 'carwash',
        entityId: null,
        summary: `${before ? 'Changed' : 'Entered'} the carwash takings for ${day}: ${formatEuro(takings.carwash)} carwash + ${formatEuro(takings.change)} change`,
        details: {
          day,
          ...takings,
          ...(before && { before: { carwash: Number(before.carwash_amount), change: Number(before.change_amount) } }),
        },
      });
    });
  }

  async remove(day: string, actorId: number): Promise<void> {
    const before = await this.carwashRepository.findDay(day);
    if (!before) throw new NotFoundError(`No carwash takings were entered for ${day}`);
    await this.transactions.run(async (repos) => {
      await repos.carwash.remove(day);
      await repos.activityLog.create({
        userId: actorId,
        action: 'carwash.removed',
        entityType: 'carwash',
        entityId: null,
        summary: `Removed the carwash takings for ${day}`,
        details: { day, carwash: Number(before.carwash_amount), change: Number(before.change_amount) },
      });
    });
  }
}
