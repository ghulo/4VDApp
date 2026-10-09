import { NOTIFICATION_TYPES } from '../constants/notifications.js';
import type { ServerMessages } from '../i18n/messages.js';
import type { CashCountRepository, CashPlace } from '../repositories/CashCountRepository.js';
import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import type { SupplierBillRepository } from '../repositories/SupplierBillRepository.js';
import type { TabRepository } from '../repositories/TabRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { OVERSEER_ROLES } from '../utils/roles.js';
import { zonedDay, zonedDays } from '../utils/zonedDates.js';
import type { DateRange } from './reports/calculations.js';
import type { CarwashService } from './CarwashService.js';
import type { SettingsService } from './SettingsService.js';

/** Differences smaller than this (a few coins) count as a match. */
export const CASH_TOLERANCE = 0.5;

export interface CashCountDto {
  id: number;
  place: CashPlace;
  /** Which carwash; null for the shop. */
  carwashId: number | null;
  carwashName: string | null;
  day: string;
  float: number;
  counted: number;
  /** That day's shop sales (less tab sales, plus tab payments, less suppliers paid from the drawer), or the carwash takings; null when the carwash has none to compare with. */
  expected: number | null;
  /** counted − float − expected: below 0 is short, above 0 is over. Null when there is nothing to compare with. */
  difference: number | null;
  note: string | null;
  countedBy: string | null;
  countedAt: string;
}

/** What staff see: whether today's count is done, never what the app expects (the count stays blind). */
export interface CashPlaceToday {
  place: CashPlace;
  carwashId: number | null;
  /** The carwash's name; null for the shop. */
  name: string | null;
  float: number;
  countedBy: string | null;
  countedAt: string | null;
}

const isMatch = (difference: number) => Math.abs(difference) < CASH_TOLERANCE;

/**
 * The end-of-day cash check for the shop and the carwash. Staff count the
 * drawer (float included); the app takes off the float and compares the rest
 * with that day's sales or carwash takings, and tells the owner when they
 * don't match.
 */
export class CashCountService {
  constructor(
    private readonly cashCountRepository: CashCountRepository,
    private readonly reportsRepository: ReportsRepository,
    private readonly tabRepository: TabRepository,
    private readonly billRepository: SupplierBillRepository,
    private readonly settingsService: SettingsService,
    private readonly carwashService: CarwashService,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async list(range: DateRange): Promise<CashCountDto[]> {
    const { from, to } = zonedDays(range, this.timeZone);
    return this.between(from, to);
  }

  private async between(from: string, to: string): Promise<CashCountDto[]> {
    const [rows, shop, tabs, supplierPayments, carwash] = await Promise.all([
      this.cashCountRepository.findBetween(from, to),
      this.reportsRepository.shopRevenueByDay(from, to, this.timeZone),
      // Tab sales never reach the drawer; tab payments do.
      this.tabRepository.drawerEffectByDay(from, to, this.timeZone),
      // Suppliers paid with cash from the till.
      this.billRepository.drawerPaymentsByDay(from, to),
      this.cashCountRepository.carwashTakingsByDay(from, to),
    ]);
    return rows.map((row) => {
      const float = Number(row.float_amount);
      const counted = Number(row.counted_amount);
      const expected =
        row.place === 'shop'
          ? roundMoney((shop.get(row.day) ?? 0) + (tabs.get(row.day) ?? 0) - (supplierPayments.get(row.day) ?? 0))
          : (carwash.get(`${row.carwash_id}|${row.day}`) ?? null);
      return {
        id: row.id,
        place: row.place,
        carwashId: row.carwash_id,
        carwashName: row.carwash_name,
        day: row.day,
        float,
        counted,
        expected,
        difference: expected === null ? null : roundMoney(counted - float - expected),
        note: row.note,
        countedBy: row.counted_by_name,
        countedAt: row.counted_at.toISOString(),
      };
    });
  }

  async today(now = new Date()): Promise<CashPlaceToday[]> {
    const day = zonedDay(now, this.timeZone);
    const [rows, settings, carwashes] = await Promise.all([
      this.cashCountRepository.findBetween(day, day),
      this.settingsService.get(),
      this.carwashService.carwashes(),
    ]);
    const drawers: Array<{ place: CashPlace; carwashId: number | null; name: string | null; float: number }> = [
      { place: 'shop', carwashId: null, name: null, float: settings.cashFloatShop },
      ...carwashes.map((carwash) => ({ place: 'carwash' as const, carwashId: carwash.id, name: carwash.name, float: carwash.cashFloat })),
    ];
    return drawers.map((drawer) => {
      const row = rows.find((count) => count.place === drawer.place && count.carwash_id === drawer.carwashId);
      return { ...drawer, countedBy: row?.counted_by_name ?? null, countedAt: row?.counted_at.toISOString() ?? null };
    });
  }

  /** Today's count for one drawer, replacing an earlier one. Tells the overseers when it's off. */
  async count(
    input: { place: CashPlace; carwashId?: number; counted: number; note: string | null },
    actor: { id: number; name: string },
    now = new Date(),
  ): Promise<CashCountDto> {
    const day = zonedDay(now, this.timeZone);
    const carwash = input.place === 'carwash' ? await this.carwashService.resolve(input.carwashId) : null;
    const float = carwash ? carwash.cashFloat : (await this.settingsService.get()).cashFloatShop;
    const carwashName = carwash ? ((await this.carwashService.displayNames()).get(carwash.id) ?? null) : null;
    const drawerName = carwash ? `${carwash.name} carwash` : 'shop';
    const id = await this.transactions.run(async (repos) => {
      const countId = await repos.cashCounts.save({
        place: input.place,
        carwashId: carwash?.id ?? null,
        day,
        float,
        counted: input.counted,
        note: input.note,
        countedBy: actor.id,
      });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'cash.counted',
        entityType: 'cash_count',
        entityId: countId,
        summary: `Counted ${formatEuro(input.counted)} in the ${drawerName} drawer (float ${formatEuro(float)})`,
        details: { place: input.place, carwashId: carwash?.id ?? null, day, counted: input.counted, float },
      });
      return countId;
    });

    const result = (await this.between(day, day)).find((count) => count.id === id)!;
    if (result.difference !== null && !isMatch(result.difference)) {
      const { difference, expected, counted } = result;
      await this.transactions.run((repos) =>
        repos.notifications.createForRoles(OVERSEER_ROLES, {
          type: NOTIFICATION_TYPES.CASH_DIFFERENCE,
          write: (t) => ({
            title: t.cashDifferenceTitle({ place: input.place, carwash: carwashName, difference }),
            message: t.cashDifferenceMessage({ name: actor.name, counted, float, expected: expected! }),
          }),
        }),
      );
    }
    return result;
  }

  /** Lines for the owner's daily summary: how each drawer came out today. */
  async summaryLines(now: Date, t: ServerMessages): Promise<string[]> {
    const day = zonedDay(now, this.timeZone);
    const counts = await this.between(day, day);
    const names = await this.carwashService.displayNames();
    const shop = counts.find((count) => count.place === 'shop');
    const line = (place: CashPlace, carwash: string | null, difference: number | null) =>
      t.dailyCash({ place, carwash, difference: difference === null || isMatch(difference) ? 0 : difference, compared: difference !== null });
    return [
      shop ? line('shop', null, shop.difference) : t.dailyCashMissing('shop', null),
      // A carwash's line only once someone counts there, so a shop without one isn't nagged.
      ...counts
        .filter((count) => count.place === 'carwash')
        .map((count) => line('carwash', names.get(count.carwashId!) ?? null, count.difference)),
    ];
  }
}
