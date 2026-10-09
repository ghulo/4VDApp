import { NOTIFICATION_TYPES } from '../../constants/notifications.js';
import { ValidationError } from '../../errors/httpErrors.js';
import { messages } from '../../i18n/messages.js';
import type { NotificationRepository } from '../../repositories/NotificationRepository.js';
import type { Recipient, ReportSubscriptionRepository, SubscriptionRow } from '../../repositories/ReportSubscriptionRepository.js';
import type { Language } from '../../i18n/language.js';
import { isoWeekday, zonedDay, zonedHour } from '../../utils/zonedDates.js';
import type { EmailService } from '../email/EmailService.js';
import { emailTemplates } from '../email/templates.js';
import { pickSections, type Report, type ReportBuilder, reportHeadline, type ReportKind, reportPeriod, REPORT_SECTIONS } from './ReportBuilder.js';
import { reportText } from './reportText.js';

export interface ReportSettings {
  daily: { enabled: boolean; hour: number };
  weekly: { enabled: boolean; day: number; hour: number };
  /** The sections they get, in report order. */
  sections: string[];
  /** Also send it by email; the alert and push always come. */
  email: boolean;
}

const toSettings = (row: SubscriptionRow): ReportSettings => ({
  daily: { enabled: row.daily_enabled, hour: row.daily_hour },
  weekly: { enabled: row.weekly_enabled, day: row.weekly_day, hour: row.weekly_hour },
  sections: row.sections ?? [...REPORT_SECTIONS],
  email: row.email,
});

/** Where a tap on the alert goes, in the dashboard and the team app alike. */
export const reportLink = (kind: ReportKind, from: string) => `/report?kind=${kind}&from=${from}`;

/**
 * Sends each owner, admin and developer their own daily and weekly report,
 * when they asked for it: an alert (pushed to their phones and computers) that
 * opens the full report, plus an email if they want one.
 */
export class ReportDeliveryService {
  constructor(
    private readonly builder: ReportBuilder,
    private readonly subscriptions: ReportSubscriptionRepository,
    private readonly notifications: NotificationRepository,
    private readonly emailService: EmailService,
    private readonly timeZone: string,
    private readonly dashboardUrl: string,
  ) {}

  async settings(userId: number): Promise<ReportSettings> {
    return toSettings(await this.subscriptions.find(userId));
  }

  async saveSettings(userId: number, settings: ReportSettings): Promise<ReportSettings> {
    const sections = REPORT_SECTIONS.filter((section) => settings.sections.includes(section));
    if (sections.length === 0) throw new ValidationError('Keep at least one section in the report');
    await this.subscriptions.save(userId, {
      daily_enabled: settings.daily.enabled,
      daily_hour: settings.daily.hour,
      weekly_enabled: settings.weekly.enabled,
      weekly_day: settings.weekly.day,
      weekly_hour: settings.weekly.hour,
      // Everything chosen is stored as "all", so sections added later reach them too.
      sections: sections.length === REPORT_SECTIONS.length ? null : sections,
      email: settings.email,
    });
    return this.settings(userId);
  }

  /** The report to show on its page, cut to what this person chose. */
  async view(userId: number, language: Language, kind: ReportKind, from: string | undefined, now = new Date()) {
    const report = await this.builder.build(kind, from ?? this.builder.latestFrom(kind, now), now, messages[language]);
    const { sections } = await this.settings(userId);
    return { ...pickSections(report, sections), chosenSections: sections };
  }

  /**
   * Called every minute by the server. Sends whatever is due for each person;
   * the weekly one covers the 7 days before their chosen day. Returns how many went out.
   */
  async sendDue(now = new Date()): Promise<number> {
    const today = zonedDay(now, this.timeZone);
    const hour = zonedHour(now, this.timeZone);
    const weekday = isoWeekday(today);
    const built = new Map<string, Promise<Report>>();
    const reportFor = (kind: ReportKind, language: Language) => {
      const key = `${kind}|${language}`;
      if (!built.has(key)) built.set(key, this.builder.build(kind, this.builder.latestFrom(kind, now), now, messages[language]));
      return built.get(key)!;
    };

    let sent = 0;
    for (const person of await this.subscriptions.recipients()) {
      const due: ReportKind[] = [];
      if (person.daily_enabled && hour >= person.daily_hour && person.last_daily !== today) due.push('daily');
      if (person.weekly_enabled && weekday === person.weekly_day && hour >= person.weekly_hour && person.last_weekly !== today) due.push('weekly');
      for (const kind of due) {
        if (!(await this.subscriptions.claim(person.user_id, kind, today))) continue;
        await this.deliver(person, await reportFor(kind, person.language), false);
        sent += 1;
      }
    }
    return sent;
  }

  /** "Send me this report now": the same alert, push and email, marked as a test. Doesn't change the schedule. */
  async sendTest(userId: number, kind: ReportKind, now = new Date()): Promise<void> {
    const person = (await this.subscriptions.recipients()).find((recipient) => recipient.user_id === userId);
    if (!person) throw new ValidationError('Reports are for owners, admins and developers');
    const report = await this.builder.build(kind, this.builder.latestFrom(kind, now), now, messages[person.language]);
    await this.deliver(person, report, true);
  }

  private async deliver(person: Recipient, full: Report, test: boolean): Promise<void> {
    const t = messages[person.language];
    const report = pickSections(full, person.sections);
    const headline = reportHeadline(report, t);
    const title = (test ? t.report.testPrefix : '') + headline.title;
    const link = reportLink(report.kind, report.from);
    await this.notifications.createForUser(person.user_id, {
      type: report.kind === 'daily' ? NOTIFICATION_TYPES.DAILY_REPORT : NOTIFICATION_TYPES.WEEKLY_REPORT,
      write: () => ({ title, message: headline.message }),
      link,
    });
    if (person.email) {
      await this.emailService.queue(
        person.email_address,
        emailTemplates.report(
          {
            name: person.name.split(' ')[0]!,
            subject: title,
            intro: t.report.emailIntro({ name: person.name.split(' ')[0]!, kind: report.kind, period: reportPeriod(report, t) }),
            sections: reportText(report, t),
            link: `${this.dashboardUrl}${link}`,
          },
          t,
        ),
      );
    }
  }
}
