import { Resend } from 'resend';
import { logger } from '../../utils/logger.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  /** Throws when the email could not be handed over, so the outbox retries it. */
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * Used until an email service is set up: prints the email (and so its link)
 * to the server log, which is enough to try every account flow locally.
 */
export class LogSender implements EmailSender {
  async send(email: OutgoingEmail): Promise<void> {
    logger.info('Email (not sent: no RESEND_API_KEY)', { to: email.to, subject: email.subject, text: email.text });
  }
}

export class ResendSender implements EmailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(email: OutgoingEmail): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) throw new Error(`${error.name}: ${error.message}`);
  }
}
