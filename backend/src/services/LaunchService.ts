import type { DatabaseClient } from '../database/connection.js';
import type { LaunchRepository } from '../repositories/LaunchRepository.js';
import { type WipeReport, wipeShopData } from '../scripts/wipeShopData.js';

export type LaunchStepKey = 'wiped' | 'shopDetails' | 'owner' | 'team' | 'weeklyEmail' | 'emails' | 'phoneAlerts' | 'backups';

export interface LaunchStep {
  key: LaunchStepKey;
  /** Null when the app can't see it from here (backups live on GitHub and R2). */
  done: boolean | null;
  /** Numbers the dashboard words the step with, e.g. how much test data is left. */
  facts?: Record<string, string | number>;
}

/**
 * What still stands between the test app and the real shop, worked out from
 * the data itself so it ticks off by itself. For the developer only.
 */
export class LaunchService {
  constructor(
    private readonly launchRepository: LaunchRepository,
    private readonly db: DatabaseClient,
    private readonly setup: { realEmails: boolean; phoneAlerts: boolean },
  ) {}

  /** What the wipe would delete, without deleting anything. */
  wipePreview(): Promise<WipeReport> {
    return wipeShopData(this.db, { apply: false });
  }

  /** Clears the test data for real; everything or nothing. Keeps developer accounts, the shop and its settings. */
  wipe(actorId: number): Promise<WipeReport> {
    return wipeShopData(this.db, { apply: true, actorId });
  }

  async checklist(): Promise<LaunchStep[]> {
    const facts = await this.launchRepository.facts();
    return [
      {
        key: 'wiped',
        done: facts.wiped_at !== null,
        facts: facts.wiped_at ? { wipedAt: facts.wiped_at } : { products: Number(facts.products), sales: Number(facts.sales) },
      },
      { key: 'shopDetails', done: facts.has_address && facts.has_phone && facts.has_nui },
      { key: 'owner', done: Number(facts.owners) > 0 },
      { key: 'team', done: Number(facts.employees) > 0, facts: { employees: Number(facts.employees) } },
      { key: 'weeklyEmail', done: Number(facts.owners_with_weekly_email) > 0 },
      { key: 'emails', done: this.setup.realEmails },
      { key: 'phoneAlerts', done: this.setup.phoneAlerts },
      { key: 'backups', done: null },
    ];
  }
}
