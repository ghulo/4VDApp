import { currentBusinessId, runAsBusiness } from '../database/businessContext.js';
import { createHash } from 'node:crypto';
import { NOTIFICATION_TYPES } from '../constants/notifications.js';
import type { ServerMessages } from '../i18n/messages.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { type BillEmailRecord, BillEmailRepository } from '../repositories/BillEmailRepository.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { rolesWith } from '../utils/roles.js';
import { logger } from '../utils/logger.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { BillReader } from './ai/billReader.js';
import type { BillScanService } from './BillScanService.js';
import { mediaUrl } from './mappers.js';
import type { MediaService } from './MediaService.js';

/** The shop's bill address. One shop for now, so one address. */
export const BILL_EMAIL_ADDRESS = 'bills@4vd.app';
/** The first business keeps the plain address; every other one is bills+<short>@4vd.app. */
export const FIRST_SHORT_NAME = '4vd';

export function billAddressOf(shortName: string | null): string {
  return shortName && shortName !== FIRST_SHORT_NAME ? BILL_EMAIL_ADDRESS.replace('@', `+${shortName}@`) : BILL_EMAIL_ADDRESS;
}
export const MAX_EMAIL_FILES = 5;
export const MAX_EMAIL_FILE_BYTES = 10 * 1024 * 1024;
/** Photos smaller than this are logos and signatures, not a bill. */
export const MIN_PHOTO_BYTES = 150 * 1024;
export const SENDERS_KEY = 'bill_email_senders';
const MAX_SENDERS = 50;

const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export interface IncomingFile {
  name: string | null;
  mime: string;
  /** Base64. */
  data: string;
}

export interface IncomingEmail {
  messageId: string;
  from: string;
  subject: string | null;
  files: IncomingFile[];
}

export interface ReceivedDto {
  /** `ignored`: not from an allowed sender, nothing kept. */
  status: 'ignored' | 'accepted';
  waiting: number;
  duplicates: number;
}

/** An emailed file nobody has dealt with: waiting to be read (the day's reads are used up) or not readable. */
export interface OpenBillEmailDto {
  id: number;
  sender: string;
  subject: string | null;
  fileName: string | null;
  fileUrl: string | null;
  status: 'waiting' | 'failed';
  error: string | null;
  receivedAt: string;
}

const isPdf = (file: IncomingFile) => file.mime === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');

/**
 * Supplier bills forwarded to the shop's bill address. The mail Worker passes
 * on what passed SPF or DKIM; here only team members and the senders listed in
 * Settings get through, each file is kept once, and up to the day's cap is read
 * by AI into a bill scan that waits in To do. Nothing is ever saved as a bill
 * until someone confirms the scan.
 */
export class BillEmailService {
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: BillEmailRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly userRepository: UserRepository,
    private readonly scanService: BillScanService,
    private readonly mediaService: MediaService,
    private readonly transactions: TransactionManager,
    private readonly reader: BillReader | null,
    private readonly dailyReads: number,
    private readonly timeZone: string,
  ) {}

  async receive(mail: IncomingEmail): Promise<ReceivedDto> {
    const sender = mail.from.trim().toLowerCase();
    if (!(await this.allowed(sender))) {
      logger.info('Bill email from a sender not on the list, dropped', { sender });
      return { status: 'ignored', waiting: 0, duplicates: 0 };
    }

    const files = this.billFiles(mail.files);
    if (files.length === 0) {
      await this.tellOwners((t) => t.billEmailNoFile({ sender, subject: mail.subject }));
      return { status: 'accepted', waiting: 0, duplicates: 0 };
    }

    let waiting = 0;
    let duplicates = 0;
    for (const file of files) {
      const bytes = file.bytes;
      const fileHash = createHash('sha256').update(bytes).digest('hex');
      // The same mail delivered again: already taken.
      if (await this.repository.seen(mail.messageId, fileHash)) continue;
      const base = { messageId: mail.messageId, sender, subject: mail.subject, fileName: file.name, fileHash };

      const first = await this.repository.firstWithHash(fileHash);
      if (first) {
        const id = await this.repository.create({ ...base, mediaId: null, status: 'duplicate', firstId: first.id });
        if (id !== null) {
          duplicates += 1;
          const day = zonedDay(first.received_at, this.timeZone);
          await this.tellOwners((t) => t.billEmailDuplicate({ sender, file: file.name, day }));
        }
        continue;
      }

      // Photos are shrunk like any bill photo; PDFs are kept whole.
      const mediaId = file.pdf ? await this.mediaService.storePdf(currentBusinessId(), bytes) : await this.mediaService.store(currentBusinessId(), bytes, 'bill');
      const id = await this.repository.create({ ...base, mediaId, status: 'waiting' });
      if (id === null) await this.mediaService.remove(mediaId);
      else waiting += 1;
    }
    if (waiting > 0) this.kick();
    return { status: 'accepted', waiting, duplicates };
  }

  /** Read what is waiting, up to the day's cap, one at a time and after the reply has gone. */
  kick(businessId: number | null = currentBusinessId()): void {
    if (businessId === null) return;
    // Named, not left to ride the promise chain: the queue is shared by every business.
    this.running = this.running
      .then(() => runAsBusiness(businessId, () => this.readWaiting()))
      .catch((error) => logger.error('Reading emailed bills failed', { error: String(error) }));
  }

  /** Resolves once every read started so far has finished. For tests and shutdown. */
  settled(): Promise<void> {
    return this.running;
  }

  /** Someone who runs the shop asks for it now: the daily cap is for mail nobody is watching. */
  async readNow(id: number): Promise<{ scanId: number | null; error: string | null }> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundError(`Emailed bill ${id} does not exist`);
    if (row.status !== 'waiting' && row.status !== 'failed') throw new ConflictError('This emailed bill has already been dealt with');
    let result: { scanId: number | null; error: string | null } = { scanId: null, error: null };
    // In line with the background reads, so one file is never read twice at once.
    const run = this.running.then(async () => {
      const fresh = await this.repository.findById(id);
      if (fresh?.status !== 'waiting' && fresh?.status !== 'failed') {
        result = { scanId: fresh?.scan_id ?? null, error: null };
        return;
      }
      result = await this.readOne(fresh);
    });
    this.running = run.catch(() => undefined);
    await run;
    return result;
  }

  async remove(id: number, userId: number): Promise<void> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundError(`Emailed bill ${id} does not exist`);
    if (row.status !== 'waiting' && row.status !== 'failed') throw new ConflictError('This emailed bill has already been dealt with');
    // The file is kept: removing only takes it off the list, and the same file can be sent again.
    await this.transactions.run(async (repos) => {
      await new BillEmailRepository(repos.db).markRemoved(id);
      await repos.activityLog.create({
        userId,
        action: 'bill.email_removed',
        entityType: null,
        entityId: null,
        say: { key: 'billEmailRemoved', params: { file: row.file_name ?? row.subject ?? '?', sender: row.sender } },
        details: { billEmailId: id },
      });
    });
  }

  async open(): Promise<OpenBillEmailDto[]> {
    return (await this.repository.open()).map((row) => ({
      id: row.id,
      sender: row.sender,
      subject: row.subject,
      fileName: row.file_name,
      fileUrl: mediaUrl(row.media_id),
      status: row.status as 'waiting' | 'failed',
      error: row.error,
      receivedAt: row.received_at.toISOString(),
    }));
  }

  /** The bill address, the day's cap and the extra senders, for Settings. */
  async settings(): Promise<{ address: string; dailyReads: number; senders: string[] }> {
    const businessId = currentBusinessId();
    const shortName = businessId === null ? null : await this.userRepository.shortName(businessId);
    return { address: billAddressOf(shortName), dailyReads: this.dailyReads, senders: await this.senders() };
  }

  async setSenders(input: string[], userId: number): Promise<string[]> {
    const senders = [...new Set(input.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
    if (senders.length > MAX_SENDERS) throw new ValidationError(`senders: at most ${MAX_SENDERS}`);
    const wrong = senders.find((entry) => !(EMAIL.test(entry) || DOMAIN.test(entry)));
    if (wrong) throw new ValidationError(`senders: ${wrong} is neither an email address nor a domain written as @supplier.com`);
    const before = await this.senders();
    await this.transactions.run(async (repos) => {
      await repos.settings.set(SENDERS_KEY, senders, userId);
      await repos.activityLog.create({
        userId,
        action: 'settings.updated',
        entityType: 'settings',
        entityId: null,
        say: { key: 'billSendersChanged', params: { count: senders.length } },
        details: { billEmailSenders: { from: before, to: senders } },
      });
    });
    return senders;
  }

  private async senders(): Promise<string[]> {
    const stored = (await this.settingsRepository.all()).get(SENDERS_KEY);
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
  }

  /** Team members who still have an account, and the senders listed in Settings (an address, or a whole @domain). */
  private async allowed(sender: string): Promise<boolean> {
    if (!EMAIL.test(sender)) return false;
    // Someone who works for this business and isn't blocked here; a member of another business is not enough.
    const person = await this.userRepository.personByEmail(sender);
    if (person?.is_active) return true;
    const domain = `@${sender.split('@').pop()}`;
    return (await this.senders()).some((entry) => entry === sender || entry === domain);
  }

  /** PDFs; when there are none, photos big enough to be a bill (a phone snap). At most five, each under 10 MB. */
  private billFiles(files: IncomingFile[]): Array<{ name: string | null; pdf: boolean; bytes: Buffer }> {
    const decoded = files.map((file) => ({ name: file.name?.slice(0, 200) ?? null, pdf: isPdf(file), mime: file.mime, bytes: Buffer.from(file.data, 'base64') }));
    const fits = decoded.filter((file) => file.bytes.length > 0 && file.bytes.length <= MAX_EMAIL_FILE_BYTES);
    const pdfs = fits.filter((file) => file.pdf);
    const chosen = pdfs.length > 0 ? pdfs : fits.filter((file) => PHOTO_MIMES.has(file.mime) && file.bytes.length >= MIN_PHOTO_BYTES);
    return chosen.slice(0, MAX_EMAIL_FILES).map(({ name, pdf, bytes }) => ({ name, pdf, bytes }));
  }

  private async readWaiting(): Promise<void> {
    for (const row of await this.repository.waiting()) {
      const used = await this.repository.readsOn(zonedDay(new Date(), this.timeZone), this.timeZone);
      // Over the cap it waits, shown in To do, until tomorrow or until someone reads it.
      if (used >= this.dailyReads) return;
      await this.readOne(row);
    }
  }

  private async readOne(row: BillEmailRecord): Promise<{ scanId: number | null; error: string | null }> {
    const now = new Date();
    try {
      if (!this.reader) throw new Error('Reading bills needs ANTHROPIC_API_KEY in the server settings');
      if (!row.media_id) throw new Error('The file is gone');
      const stored = await this.mediaService.read(row.media_id);
      const reading = await this.reader.read([{ mime: stored.mime, bytes: stored.bytes }]);
      const scanId = await this.transactions.run((repos) => this.scanService.createFromEmail({ mediaId: row.media_id!, reading, sender: row.sender }, repos));
      await this.repository.markRead(row.id, scanId, now);
      return { scanId, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('An emailed bill could not be read', { id: row.id, error: message });
      await this.repository.markFailed(row.id, message.slice(0, 500), now);
      return { scanId: null, error: message };
    }
  }

  private async tellOwners(message: (t: ServerMessages) => string) {
    await this.transactions.run((repos) =>
      repos.notifications.createForRoles(rolesWith('oversee'), {
        type: NOTIFICATION_TYPES.BILL_EMAIL,
        write: (t) => ({ title: t.billEmailTitle, message: message(t) }),
        link: '/bills',
      }),
    );
  }
}
