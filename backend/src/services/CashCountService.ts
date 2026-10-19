import { NOTIFICATION_TYPES } from '../constants/notifications.js';
import { NotFoundError } from '../errors/httpErrors.js';
import type { ServerMessages } from '../i18n/messages.js';
import type { CashCountRepository, CashPlace } from '../repositories/CashCountRepository.js';
import type { MoneyRepository } from '../repositories/MoneyRepository.js';
import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import type { SupplierBillRepository } from '../repositories/SupplierBillRepository.js';
import type { TabRepository } from '../repositories/TabRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { rolesWith } from '../utils/roles.js';
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
  /** The account that counted it; null once that account is removed. */
  countedById: number | null;
  countedAt: string;
  /** Who looked at the difference and when; null until someone does. */
  checkedBy: string | null;
  checkedAt: string | null;
}

/** What staff see: whether today's count is done, never what the app expects (the count stays blind). */
export interface CashPlaceToday {
  place: CashPlace;
  carwashId: number | null;
  /** The carwash's name; null for the shop. */
  name: string | null;
  float: number;
  /** The cash counted into the drawer at the start of the day; null until someone does. */
  opening: { amount: number; by: string | null; at: string } | null;
  countedBy: string | null;
  countedAt: string | null;
}

/** For overseers at the Counter: the shop drawer's opening cash and what it should hold now. */
export interface DrawerNow {
  opening: number | null;
  shouldHold: number;
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
    private readonly moneyRepository: MoneyRepository,
    private readonly settingsService: SettingsService,
    private readonly carwashService: CarwashService,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async list(range: DateRange): Promise<CashCountDto[]> {
    const { from, to } = zonedDays(range, this.timeZone);
    return this.between(from, to);
  }

  /** Every count made on one shop day, with how it compared. */
  onDay(day: string): Promise<CashCountDto[]> {
    return this.between(day, day);
  }

  private async between(from: string, to: string): Promise<CashCountDto[]> {
    const [rows, shop, tabs, supplierPayments, carwash, tills, moves, card] = await Promise.all([
      this.cashCountRepository.findBetween(from, to),
      this.reportsRepository.shopRevenueByDay(from, to, this.timeZone),
      // Tab sales never reach the drawer; tab payments do.
      this.tabRepository.drawerEffectByDay(from, to, this.timeZone),
      // Suppliers paid with cash from a till.
      this.billRepository.drawerPaymentsByDay(from, to),
      this.cashCountRepository.carwashTakingsByDay(from, to),
      this.moneyRepository.tills(),
      // Money moved into or out of a till that day before it was counted (a deposit at noon).
      this.moneyRepository.movesBeforeCounts(from, to),
      // Sales paid by card went to the bank, not the drawer.
      this.moneyRepository.cardSalesByDay(from, to, this.timeZone),
    ]);
    return rows.map((row) => {
      const float = Number(row.float_amount);
      const counted = Number(row.counted_amount);
      const till = tills.get(row.place === 'shop' ? null : row.carwash_id);
      const paidOut = supplierPayments.get(`${till}|${row.day}`) ?? 0;
      const moved = moves.get(row.id) ?? 0;
      const takings = row.place === 'shop' ? (shop.get(row.day) ?? 0) + (tabs.get(row.day) ?? 0) - (card.get(row.day) ?? 0) : (carwash.get(`${row.carwash_id}|${row.day}`) ?? null);
      const expected = takings === null && paidOut === 0 && moved === 0 ? null : roundMoney((takings ?? 0) - paidOut + moved);
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
        countedById: row.counted_by,
        countedAt: row.counted_at.toISOString(),
        checkedBy: row.checked_by_name,
        checkedAt: row.checked_at?.toISOString() ?? null,
      };
    });
  }

  today(now = new Date()): Promise<CashPlaceToday[]> {
    return this.drawersOn(zonedDay(now, this.timeZone));
  }

  /** Each drawer and whether it was counted on `day` (blind: no expected amount). */
  async drawersOn(day: string): Promise<CashPlaceToday[]> {
    const [rows, openings, settings, carwashes] = await Promise.all([
      this.cashCountRepository.findBetween(day, day),
      this.cashCountRepository.openingsOn(day),
      this.settingsService.get(),
      this.carwashService.carwashes(),
    ]);
    const drawers: Array<{ place: CashPlace; carwashId: number | null; name: string | null; float: number }> = [
      { place: 'shop', carwashId: null, name: null, float: settings.cashFloatShop },
      ...carwashes.map((carwash) => ({ place: 'carwash' as const, carwashId: carwash.id, name: carwash.name, float: carwash.cashFloat })),
    ];
    return drawers.map((drawer) => {
      const row = rows.find((count) => count.place === drawer.place && count.carwash_id === drawer.carwashId);
      const opening = openings.find((entry) => entry.place === drawer.place && entry.carwash_id === drawer.carwashId);
      return {
        ...drawer,
        // Once counted, the float that drawer really started with today; before that, its opening cash.
        float: row ? Number(row.float_amount) : opening ? Number(opening.amount) : drawer.float,
        opening: opening ? { amount: Number(opening.amount), by: opening.opened_by_name, at: opening.opened_at.toISOString() } : null,
        countedBy: row?.counted_by_name ?? null,
        countedAt: row?.counted_at.toISOString() ?? null,
      };
    });
  }

  /** Counts from the last `days` days whose difference nobody has looked at yet, newest first. */
  async unchecked(days: number, now = new Date()): Promise<CashCountDto[]> {
    const to = zonedDay(now, this.timeZone);
    const from = zonedDay(new Date(now.getTime() - days * 24 * 60 * 60 * 1000), this.timeZone);
    const counts = await this.between(from, to);
    return counts.filter((count) => count.difference !== null && !isMatch(count.difference) && count.checkedAt === null);
  }

  /** Someone who oversees the money has looked at a count's difference, so it leaves the To do list. */
  async markChecked(id: number, actorId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      if (!(await repos.cashCounts.markChecked(id, actorId))) throw new NotFoundError(`Cash count ${id} does not exist`);
      await repos.activityLog.create({
        userId: actorId,
        action: 'cash.checked',
        entityType: 'cash_count',
        entityId: id,
        say: { key: 'cashDifferenceChecked' },
        details: {},
      });
    });
  }

  /** Today's count for one drawer, replacing an earlier one. Tells the overseers when it's off. */
  async count(
    input: { place: CashPlace; carwashId?: number; counted: number; float?: number; note: string | null },
    actor: { id: number; name: string },
    now = new Date(),
  ): Promise<CashCountDto> {
    const day = zonedDay(now, this.timeZone);
    const carwash = input.place === 'carwash' ? await this.carwashService.resolve(input.carwashId) : null;
    // The opening cash counted this morning, else the float from Settings; whoever counts can say the drawer started with something else today.
    const opening = (await this.cashCountRepository.openingsOn(day)).find((entry) => entry.place === input.place && entry.carwash_id === (carwash?.id ?? null));
    const float = input.float ?? (opening ? Number(opening.amount) : carwash ? carwash.cashFloat : (await this.settingsService.get()).cashFloatShop);
    const carwashName = carwash ? ((await this.carwashService.displayNames()).get(carwash.id) ?? null) : null;
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
        say: { key: 'cashCounted', params: { counted: input.counted, drawer: carwash ? carwash.name : null, float } },
        details: { place: input.place, carwashId: carwash?.id ?? null, day, counted: input.counted, float },
      });
      return countId;
    });

    const result = (await this.between(day, day)).find((count) => count.id === id)!;
    if (result.difference !== null && !isMatch(result.difference)) {
      const { difference, expected, counted } = result;
      await this.transactions.run((repos) =>
        repos.notifications.createForRoles(rolesWith('oversee'), {
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

  /** The cash counted into a drawer before the first sale; counting it again the same day replaces it. Returns today's drawers. */
  async open(input: { place: CashPlace; carwashId?: number; amount: number }, actorId: number, now = new Date()): Promise<CashPlaceToday[]> {
    const day = zonedDay(now, this.timeZone);
    const carwash = input.place === 'carwash' ? await this.carwashService.resolve(input.carwashId) : null;
    await this.transactions.run(async (repos) => {
      await repos.cashCounts.saveOpening({ place: input.place, carwashId: carwash?.id ?? null, day, amount: input.amount, openedBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'cash.opened',
        entityType: 'cash_count',
        entityId: null,
        say: { key: 'cashOpened', params: { amount: input.amount, drawer: carwash ? carwash.name : null } },
        details: { place: input.place, carwashId: carwash?.id ?? null, day, amount: input.amount },
      });
    });
    return this.drawersOn(day);
  }

  /**
   * What the shop drawer should hold right now: its opening cash (else the
   * usual float), plus today's cash takings and tab payments, less card sales,
   * suppliers paid from it and money moved out. Only for overseers.
   */
  async shopDrawerNow(now = new Date()): Promise<DrawerNow> {
    const day = zonedDay(now, this.timeZone);
    const [openings, settings, shop, tabs, supplierPayments, tills, moves, card] = await Promise.all([
      this.cashCountRepository.openingsOn(day),
      this.settingsService.get(),
      this.reportsRepository.shopRevenueByDay(day, day, this.timeZone),
      this.tabRepository.drawerEffectByDay(day, day, this.timeZone),
      this.billRepository.drawerPaymentsByDay(day, day),
      this.moneyRepository.tills(),
      this.moneyRepository.tillMovesOn(day),
      this.moneyRepository.cardSalesByDay(day, day, this.timeZone),
    ]);
    const opening = openings.find((entry) => entry.place === 'shop');
    const float = opening ? Number(opening.amount) : settings.cashFloatShop;
    const takings = (shop.get(day) ?? 0) + (tabs.get(day) ?? 0) - (card.get(day) ?? 0);
    const paidOut = supplierPayments.get(`${tills.get(null)}|${day}`) ?? 0;
    return { opening: opening ? Number(opening.amount) : null, shouldHold: roundMoney(float + takings - paidOut + (moves.get(null) ?? 0)) };
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
