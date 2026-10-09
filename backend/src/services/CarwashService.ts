import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CarwashRecord, CarwashRepository } from '../repositories/CarwashRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay, zonedDays } from '../utils/zonedDates.js';
import type { DateRange } from './reports/calculations.js';

export interface CarwashTotals {
  carwash: number;
  /** What the change machine made: notes changed into coins. */
  change: number;
  /** Carwash + change. */
  total: number;
  /** How many carwash-days have takings entered. */
  days: number;
}

export interface CarwashDto {
  id: number;
  name: string;
  /** Change left in its drawer every night. */
  cashFloat: number;
  archived: boolean;
}

export interface CarwashDayDto {
  carwashId: number;
  carwashName: string;
  day: string;
  carwash: number;
  change: number;
  total: number;
  recordedBy: string | null;
  updatedAt: string;
}

export interface CarwashTotalsByCarwash extends CarwashTotals {
  carwashId: number;
  name: string;
}

export interface CarwashTakings {
  carwash: number;
  change: number;
}

const toDto = (row: CarwashRecord): CarwashDto => ({
  id: row.id,
  name: row.name,
  cashFloat: Number(row.cash_float),
  archived: row.archived_at !== null,
});

const toTotals = (row: { carwash: string; change: string; days: string }): CarwashTotals => {
  const carwash = Number(row.carwash);
  const change = Number(row.change);
  return { carwash, change, total: roundMoney(carwash + change), days: Number(row.days) };
};

/**
 * The carwashes, the other half of 4VD SH.P.K. They have no products: someone
 * enters what each made every day, split into the wash and the change machine.
 * There can be several; archiving one keeps its history but stops new entries.
 */
export class CarwashService {
  constructor(
    private readonly carwashRepository: CarwashRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  // ---- the carwashes themselves ----

  /** Open carwashes first; archived ones only when asked for. */
  async carwashes(options: { includeArchived: boolean } = { includeArchived: false }): Promise<CarwashDto[]> {
    const all = (await this.carwashRepository.findAll()).map(toDto);
    return options.includeArchived ? all : all.filter((carwash) => !carwash.archived);
  }

  /**
   * Names to show next to carwash figures: only when there are several open
   * carwashes. With one, the figures just say "carwash", as they always did.
   */
  async displayNames(): Promise<Map<number, string | null>> {
    const all = await this.carwashRepository.findAll();
    const severalOpen = all.filter((carwash) => carwash.archived_at === null).length > 1;
    return new Map(all.map((carwash) => [carwash.id, severalOpen ? carwash.name : null]));
  }

  /** The carwash an entry is for. Left out, it means the only open carwash; with several, it has to be said. */
  async resolve(carwashId: number | undefined): Promise<CarwashDto> {
    if (carwashId === undefined) {
      const open = await this.carwashes();
      if (open.length === 1) return open[0]!;
      throw new ValidationError('Say which carwash this is for');
    }
    const carwash = await this.carwashRepository.findById(carwashId);
    if (!carwash) throw new NotFoundError(`Carwash ${carwashId} does not exist`);
    if (carwash.archived_at) throw new ConflictError(`${carwash.name} is archived; restore it in Settings to enter more`);
    return toDto(carwash);
  }

  async add(input: { name: string; cashFloat: number }, actorId: number): Promise<CarwashDto> {
    if (await this.carwashRepository.openNameTaken(input.name)) throw new ConflictError(`There is already a carwash called ${input.name}`);
    const id = await this.transactions.run(async (repos) => {
      const newId = await repos.carwash.addCarwash(input);
      await repos.activityLog.create({
        userId: actorId,
        action: 'carwash.created',
        entityType: 'carwash',
        entityId: newId,
        summary: `Added the carwash ${input.name} (cash float ${formatEuro(input.cashFloat)})`,
        details: { ...input },
      });
      return newId;
    });
    return toDto((await this.carwashRepository.findById(id))!);
  }

  async update(
    id: number,
    changes: { name?: string; cashFloat?: number; archived?: boolean },
    actorId: number,
    now = new Date(),
  ): Promise<CarwashDto> {
    const before = await this.carwashRepository.findById(id);
    if (!before) throw new NotFoundError(`Carwash ${id} does not exist`);
    const wasArchived = before.archived_at !== null;
    const name = changes.name ?? before.name;
    const staysOpen = changes.archived === undefined ? !wasArchived : !changes.archived;

    if (changes.archived === true && wasArchived) throw new ConflictError(`${before.name} is already archived`);
    if (changes.archived === true && (await this.carwashes()).length <= 1) {
      throw new ConflictError('Keep at least one carwash open; add the new one first');
    }
    if (staysOpen && (changes.name !== undefined || changes.archived === false) && (await this.carwashRepository.openNameTaken(name, id))) {
      throw new ConflictError(`There is already a carwash called ${name}`);
    }

    const renamed = changes.name !== undefined && changes.name !== before.name;
    const floatChanged = changes.cashFloat !== undefined && changes.cashFloat !== Number(before.cash_float);
    await this.transactions.run(async (repos) => {
      await repos.carwash.updateCarwash(id, {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.cashFloat !== undefined && { cashFloat: changes.cashFloat }),
        ...(changes.archived !== undefined && { archivedAt: changes.archived ? now : null }),
      });
      if (changes.archived !== undefined && changes.archived !== wasArchived) {
        // A closed carwash stops adding its monthly expenses; restoring it doesn't bring them back.
        const stoppedExpenses = changes.archived ? await repos.expenses.stopRecurringForCarwash(id, now) : 0;
        await repos.activityLog.create({
          userId: actorId,
          action: changes.archived ? 'carwash.archived' : 'carwash.restored',
          entityType: 'carwash',
          entityId: id,
          summary: `${changes.archived ? 'Archived' : 'Restored'} the carwash ${before.name}${stoppedExpenses > 0 ? `; its ${stoppedExpenses} monthly expense${stoppedExpenses === 1 ? '' : 's'} stopped repeating` : ''}`,
          details: { name: before.name, stoppedExpenses },
        });
      }
      if (renamed || floatChanged) {
        await repos.activityLog.create({
          userId: actorId,
          action: 'carwash.updated',
          entityType: 'carwash',
          entityId: id,
          summary: [
            renamed ? `Renamed the carwash ${before.name} to ${changes.name}` : `Changed the carwash ${before.name}`,
            floatChanged ? `cash float from ${formatEuro(Number(before.cash_float))} to ${formatEuro(changes.cashFloat!)}` : null,
          ]
            .filter(Boolean)
            .join(': '),
          details: { before: { name: before.name, cashFloat: Number(before.cash_float) }, after: { name, cashFloat: changes.cashFloat ?? Number(before.cash_float) } },
        });
      }
    });
    return toDto((await this.carwashRepository.findById(id))!);
  }

  // ---- takings ----

  async list(range: DateRange, carwashId?: number): Promise<{ days: CarwashDayDto[]; totals: CarwashTotals; byCarwash: CarwashTotalsByCarwash[] }> {
    const { from, to } = zonedDays(range, this.timeZone);
    const [rows, byCarwash] = await Promise.all([this.carwashRepository.findBetween(from, to, carwashId), this.totalsByCarwash(range)]);
    const shown = carwashId === undefined ? byCarwash : byCarwash.filter((row) => row.carwashId === carwashId);
    return {
      days: rows.map((row) => {
        const carwash = Number(row.carwash_amount);
        const change = Number(row.change_amount);
        return {
          carwashId: row.carwash_id,
          carwashName: row.carwash_name,
          day: row.day,
          carwash,
          change,
          total: roundMoney(carwash + change),
          recordedBy: row.recorded_by_name,
          updatedAt: row.updated_at.toISOString(),
        };
      }),
      totals: sumTotals(shown),
      byCarwash,
    };
  }

  /** Every carwash that has takings in the period, each added up. */
  async totalsByCarwash(range: DateRange): Promise<CarwashTotalsByCarwash[]> {
    const { from, to } = zonedDays(range, this.timeZone);
    return (await this.carwashRepository.totalsByCarwash(from, to)).map((row) => ({ carwashId: row.carwash_id, name: row.name, ...toTotals(row) }));
  }

  /** All carwashes together. */
  async totals(range: DateRange): Promise<CarwashTotals> {
    return sumTotals(await this.totalsByCarwash(range));
  }

  /** Today in shop time, and for each open carwash what was entered (null when nothing yet). */
  async today(now = new Date()): Promise<{ day: string; carwashes: Array<CarwashDto & { takings: CarwashTakings | null }> }> {
    const day = zonedDay(now, this.timeZone);
    const open = await this.carwashes();
    const carwashes = await Promise.all(open.map(async (carwash) => ({ ...carwash, takings: await this.findDay(carwash.id, day) })));
    return { day, carwashes };
  }

  /** What was entered for one carwash and day, or null when nothing was. */
  async findDay(carwashId: number, day: string): Promise<CarwashTakings | null> {
    const row = await this.carwashRepository.findDay(carwashId, day);
    return row ? { carwash: Number(row.carwash_amount), change: Number(row.change_amount) } : null;
  }

  /** Enters a day's takings for a carwash, replacing what was entered before. */
  async save(
    carwashId: number | undefined,
    day: string,
    takings: CarwashTakings,
    actorId: number,
    options: { anyDay: boolean } = { anyDay: true },
    now = new Date(),
  ): Promise<void> {
    const carwash = await this.resolve(carwashId);
    const today = zonedDay(now, this.timeZone);
    if (day > today) throw new ValidationError("You can't enter takings for a day that hasn't happened yet");
    // Staff enter today's takings from the phone; earlier days are for the people who run the shop.
    if (!options.anyDay && day !== today) throw new ForbiddenError("You can only enter today's takings");
    const before = await this.carwashRepository.findDay(carwash.id, day);
    const label = await this.label(carwash);
    await this.transactions.run(async (repos) => {
      await repos.carwash.save({ carwashId: carwash.id, day, ...takings, recordedBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'carwash.recorded',
        entityType: 'carwash',
        entityId: carwash.id,
        summary: `${before ? 'Changed' : 'Entered'} the ${label} takings for ${day}: ${formatEuro(takings.carwash)} carwash + ${formatEuro(takings.change)} change`,
        details: {
          carwashId: carwash.id,
          day,
          ...takings,
          ...(before && { before: { carwash: Number(before.carwash_amount), change: Number(before.change_amount) } }),
        },
      });
    });
  }

  async remove(carwashId: number | undefined, day: string, actorId: number): Promise<void> {
    // Removing a mistaken day stays possible after a carwash is archived.
    const carwash = carwashId === undefined ? await this.resolve(undefined) : await this.known(carwashId);
    const before = await this.carwashRepository.findDay(carwash.id, day);
    if (!before) throw new NotFoundError(`No ${carwash.name} takings were entered for ${day}`);
    const label = await this.label(carwash);
    await this.transactions.run(async (repos) => {
      await repos.carwash.remove(carwash.id, day);
      await repos.activityLog.create({
        userId: actorId,
        action: 'carwash.removed',
        entityType: 'carwash',
        entityId: carwash.id,
        summary: `Removed the ${label} takings for ${day}`,
        details: { carwashId: carwash.id, day, carwash: Number(before.carwash_amount), change: Number(before.change_amount) },
      });
    });
  }

  private async known(carwashId: number): Promise<CarwashDto> {
    const carwash = await this.carwashRepository.findById(carwashId);
    if (!carwash) throw new NotFoundError(`Carwash ${carwashId} does not exist`);
    return toDto(carwash);
  }

  /** "carwash" with one open carwash, "Name carwash" ("Prishtina carwash") with several. */
  private async label(carwash: CarwashDto): Promise<string> {
    return (await this.displayNames()).get(carwash.id) ? `${carwash.name} carwash` : 'carwash';
  }
}

function sumTotals(rows: CarwashTotals[]): CarwashTotals {
  const carwash = roundMoney(rows.reduce((sum, row) => sum + row.carwash, 0));
  const change = roundMoney(rows.reduce((sum, row) => sum + row.change, 0));
  return { carwash, change, total: roundMoney(carwash + change), days: rows.reduce((sum, row) => sum + row.days, 0) };
}
