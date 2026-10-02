import type { EmailOutboxRepository } from '../../repositories/EmailOutboxRepository.js';
import { logger } from '../../utils/logger.js';
import type { EmailSender } from './senders.js';
import type { EmailContent } from './templates.js';

const BATCH_SIZE = 20;
/** After this many failed tries an email stays in the outbox for a person to look at. */
const MAX_ATTEMPTS = 5;

/**
 * Emails are written to the outbox inside the request and sent by the
 * background loop, so a slow or failing email service never slows a request
 * down or loses a message.
 */
export class EmailService {
  constructor(
    private readonly outbox: EmailOutboxRepository,
    private readonly sender: EmailSender,
  ) {}

  async queue(to: string, content: EmailContent): Promise<void> {
    await this.outbox.add({ to, ...content });
  }

  /** Called every few seconds by the server. Returns how many were sent. */
  async sendPending(): Promise<number> {
    const batch = await this.outbox.claim(BATCH_SIZE, MAX_ATTEMPTS);
    let sent = 0;
    for (const email of batch) {
      try {
        await this.sender.send({ to: email.to_address, subject: email.subject, html: email.html, text: email.text });
        await this.outbox.markSent(email.id);
        sent += 1;
      } catch (error) {
        logger.warn('Email could not be sent', { id: email.id, error: String(error) });
        await this.outbox.markFailed(email.id, String(error));
      }
    }
    return sent;
  }
}
