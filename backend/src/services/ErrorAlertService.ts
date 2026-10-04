import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { messages } from '../i18n/messages.js';
import type { EmailService } from './email/EmailService.js';
import { emailTemplates } from './email/templates.js';

/** Remembers the hour the last alert went out, so restarts and second servers don't resend within it. */
const LAST_SENT_KEY = 'error_alert_last_sent';
/** Different errors listed in one email; repeats of the same one are counted instead. */
const MAX_KINDS = 10;
const MAX_TEXT = 300;

/**
 * Emails the developer when the server logs errors, at most once an hour.
 * The first error in an hour goes out within a minute; anything after that
 * waits and arrives together in the next hour's email.
 */
export class ErrorAlertService {
  private pending = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly emailService: EmailService,
  ) {}

  /** Called for every logged error. Only counts in memory: it must never fail or log itself. */
  record(message: string, context?: Record<string, unknown>): void {
    const where = typeof context?.path === 'string' ? ` (${String(context.method ?? '')} ${context.path})`.replace('( ', '(') : '';
    const detail = typeof context?.error === 'string' ? `: ${context.error}` : '';
    const what = `${message}${where}${detail}`.slice(0, MAX_TEXT);
    this.total += 1;
    if (this.pending.has(what) || this.pending.size < MAX_KINDS) this.pending.set(what, (this.pending.get(what) ?? 0) + 1);
  }

  /** Called every minute by the server. True when it queued an alert. */
  async sendIfDue(now = new Date()): Promise<boolean> {
    if (this.total === 0) return false;
    if (!(await this.settingsRepository.claim(LAST_SENT_KEY, now.toISOString().slice(0, 13)))) return false;

    const count = this.total;
    const items = [...this.pending].map(([what, times]) => ({ what, count: times }));
    this.pending = new Map();
    this.total = 0;
    for (const person of await this.userRepository.developers()) {
      const t = messages[person.language];
      await this.emailService.queue(person.email, emailTemplates.errorAlert({ name: person.name.split(' ')[0]!, count, items }, t));
    }
    return true;
  }
}
