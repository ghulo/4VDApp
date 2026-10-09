import { DEFAULT_SETTINGS } from '../constants/approvals.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';

export interface AppSettings {
  /** Employee refunds above this many euros wait for the owner. */
  refundApprovalLimit: number;
  /** Employee returns of sales older than this many days wait for the owner. */
  returnWindowDays: number;
  /** No promotion may bring a price below cost plus this percentage. */
  minimumMarginPercent: number;
  /** Hour (0–23, shop time) the owner's daily summary goes out. */
  dailySummaryHour: number;
  /** Change left in the shop drawer every night; the cash check takes it off the count. */
  cashFloatShop: number;
}

const KEYS: Record<keyof AppSettings, string> = {
  refundApprovalLimit: 'refund_approval_limit',
  returnWindowDays: 'return_window_days',
  minimumMarginPercent: 'minimum_margin_percent',
  dailySummaryHour: 'daily_summary_hour',
  cashFloatShop: 'cash_float_shop',
};

export class SettingsService {
  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async get(): Promise<AppSettings> {
    const stored = await this.settingsRepository.all();
    const read = (name: keyof AppSettings) => {
      const value = Number(stored.get(KEYS[name]));
      return Number.isFinite(value) ? value : DEFAULT_SETTINGS[name];
    };
    return {
      refundApprovalLimit: read('refundApprovalLimit'),
      returnWindowDays: read('returnWindowDays'),
      minimumMarginPercent: read('minimumMarginPercent'),
      dailySummaryHour: read('dailySummaryHour'),
      cashFloatShop: read('cashFloatShop'),
    };
  }

  async update(input: Partial<AppSettings>, userId: number, logExtra?: Record<string, unknown>): Promise<AppSettings> {
    const before = await this.get();
    const changes = (Object.keys(input) as Array<keyof AppSettings>).filter(
      (name) => input[name] !== undefined && input[name] !== before[name],
    );
    if (changes.length > 0) {
      await this.transactions.run(async (repos) => {
        for (const name of changes) await repos.settings.set(KEYS[name], input[name], userId);
        await repos.activityLog.create({
          userId,
          action: 'settings.updated',
          entityType: 'settings',
          entityId: null,
          summary: `Changed ${changes.map((name) => describe(name, before[name], input[name]!)).join(' and ')}`,
          details: { ...Object.fromEntries(changes.map((name) => [name, { from: before[name], to: input[name] }])), ...logExtra },
        });
      });
    }
    return this.get();
  }
}

function describe(name: keyof AppSettings, from: number, to: number): string {
  switch (name) {
    case 'refundApprovalLimit':
      return `the refund approval limit from €${from} to €${to}`;
    case 'returnWindowDays':
      return `the return window from ${from} to ${to} days`;
    case 'minimumMarginPercent':
      return `the minimum margin from ${from}% to ${to}%`;
    case 'dailySummaryHour':
      return `the daily summary time from ${from}:00 to ${to}:00`;
    case 'cashFloatShop':
      return `the shop's cash float from €${from} to €${to}`;
  }
}
