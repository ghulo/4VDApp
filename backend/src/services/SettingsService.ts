import { DEFAULT_SETTINGS } from '../constants/approvals.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { checkNumbering, NUMBERED_KINDS, readRules, RULE_KEYS, type ShopRules } from './shopRules.js';
import { ValidationError } from '../errors/httpErrors.js';
import { checkSteps } from './pricing/shortDated.js';

export interface AppSettings {
  /** Employee refunds above this many euros wait for the owner. */
  refundApprovalLimit: number;
  /** Employee returns of sales older than this many days wait for the owner. */
  returnWindowDays: number;
  /** No promotion may bring a price below cost plus this percentage. */
  minimumMarginPercent: number;
  /** Hour (0–23, shop time) the owner's daily summary goes out. */
  /** Change left in the shop drawer every night; the cash check takes it off the count. */
  cashFloatShop: number;
  /** Days a customer has to pay an invoice put on their account. */
  paymentTermsDays: number;
  /** The most rabat, in percent, an employee may give at the counter; owners and admins may give any. */
  employeeDiscountLimit: number;
}

const KEYS: Record<keyof AppSettings, string> = {
  refundApprovalLimit: 'refund_approval_limit',
  returnWindowDays: 'return_window_days',
  minimumMarginPercent: 'minimum_margin_percent',
  cashFloatShop: 'cash_float_shop',
  paymentTermsDays: 'payment_terms_days',
  employeeDiscountLimit: 'employee_discount_limit',
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
      cashFloatShop: read('cashFloatShop'),
      paymentTermsDays: read('paymentTermsDays'),
      employeeDiscountLimit: read('employeeDiscountLimit'),
    };
  }

  async rules(): Promise<ShopRules> {
    return readRules(this.settingsRepository);
  }

  /** The number format applies from the next number; issued ones never change. */
  async updateRules(
    input: { numbering?: Partial<ShopRules['numbering']>; noStockSales?: ShopRules['noStockSales']; shortDated?: Partial<ShopRules['shortDated']>; features?: Partial<ShopRules['features']> },
    userId: number,
  ): Promise<ShopRules> {
    const before = await this.rules();
    const after: ShopRules = {
      numbering: input.numbering ? { ...before.numbering, ...input.numbering } : before.numbering,
      noStockSales: input.noStockSales ?? before.noStockSales,
      shortDated: input.shortDated ? { ...before.shortDated, ...input.shortDated } : before.shortDated,
      features: input.features ? { ...before.features, ...input.features } : before.features,
    };
    after.shortDated = { ...after.shortDated, steps: checkSteps(after.shortDated.steps) };
    checkNumbering(after.numbering);
    for (const kind of NUMBERED_KINDS) {
      const prefix = after.numbering[kind].prefix;
      if (prefix === before.numbering[kind].prefix) continue;
      const other = (await this.transactions.run((repos) => repos.documents.kindsNumberedWith(prefix))).find((used) => used !== kind);
      if (other) throw new ValidationError(`numbering: ${prefix} is already on ${other.replace('_', ' ')} numbers. Use other letters for ${kind.replace('_', ' ')}s.`);
    }
    const changed = (Object.keys(RULE_KEYS) as Array<keyof ShopRules>).filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
    if (changed.length > 0) {
      await this.transactions.run(async (repos) => {
        for (const name of changed) await repos.settings.set(RULE_KEYS[name], after[name], userId);
        await repos.activityLog.create({
          userId,
          action: 'settings.updated',
          entityType: 'settings',
          entityId: null,
          say: { key: 'rulesChanged', params: { numbering: changed.includes('numbering'), noStockSales: changed.includes('noStockSales') ? after.noStockSales : null, shortDated: changed.includes('shortDated'), features: changed.includes('features') } },
          details: Object.fromEntries(changed.map((name) => [name, { from: before[name], to: after[name] }])),
        });
      });
    }
    return this.rules();
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
          say: { key: 'settingsChanged', params: { changes: changes.map((name) => ({ name, from: before[name], to: input[name]! })) } },
          details: { ...Object.fromEntries(changes.map((name) => [name, { from: before[name], to: input[name] }])), ...logExtra },
        });
      });
    }
    return this.get();
  }
}
