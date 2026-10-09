import type { DatabaseClient } from '../database/connection.js';
import type { EmailService } from './email/EmailService.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { LaunchRepository } from '../repositories/LaunchRepository.js';
import { type WipeReport, wipeShopData } from '../scripts/wipeShopData.js';
import { LAST_BACKUP_KEY } from '../repositories/LaunchRepository.js';

/** The weekly backup runs on Sundays; this much slack covers a late or retried run. */
const BACKUP_FRESH_DAYS = 9;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LaunchStepKey = 'wiped' | 'shopDetails' | 'owner' | 'team' | 'reports' | 'emails' | 'phoneAlerts' | 'backups';

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
    private readonly settingsRepository: SettingsRepository,
    private readonly emailService: EmailService,
    /** `backupReports`: the backup job has a secret to tell us when it finishes. */
    private readonly setup: { realEmails: boolean; phoneAlerts: boolean; backupReports: boolean },
  ) {}

  /** The backup job calls this when a backup finished and was uploaded. */
  async recordBackup(now = new Date()): Promise<void> {
    await this.settingsRepository.claim(LAST_BACKUP_KEY, now.toISOString());
  }

  /**
   * Sends the developer a real email right now, so they see whether Resend
   * works. Says so when emails only go to the log, and passes on Resend's
   * own complaint (unverified domain, wrong key) when it refuses.
   */
  async testEmail(to: string): Promise<{ to: string; sent: boolean; reason: string | null }> {
    if (!this.setup.realEmails) {
      return { to, sent: false, reason: 'Real emails are not set up yet: RESEND_API_KEY and an EMAIL_FROM address at 4vd.app are needed.' };
    }
    try {
      await this.emailService.sendNow(to, {
        subject: 'Test email from 4VD',
        text: 'This is a test. If you can read it, 4VD can send real emails (invites, password resets, the Monday report).',
        html: '<p>This is a test. If you can read it, 4VD can send real emails (invites, password resets, the Monday report).</p>',
      });
      return { to, sent: true, reason: null };
    } catch (error) {
      return { to, sent: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

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
      { key: 'reports', done: Number(facts.owners_with_reports) > 0 },
      { key: 'emails', done: this.setup.realEmails },
      { key: 'phoneAlerts', done: this.setup.phoneAlerts },
      {
        key: 'backups',
        // Without the secret the app can't tell, so it stays "check yourself".
        done: this.setup.backupReports ? backupIsFresh(facts.last_backup_at) : null,
        ...(facts.last_backup_at && { facts: { lastBackupAt: facts.last_backup_at } }),
      },
    ];
  }
}

const backupIsFresh = (lastBackupAt: string | null, now = new Date()) =>
  lastBackupAt !== null && now.getTime() - Date.parse(lastBackupAt) < BACKUP_FRESH_DAYS * MS_PER_DAY;
