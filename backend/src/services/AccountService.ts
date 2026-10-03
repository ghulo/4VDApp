import { ConflictError, GoneError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { AccountTokenRepository } from '../repositories/AccountTokenRepository.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { hashAccountToken, newAccountToken } from '../utils/accountTokens.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import type { EmailService } from './email/EmailService.js';
import { messages } from '../i18n/messages.js';
import { emailTemplates } from './email/templates.js';

const HOUR_MS = 60 * 60 * 1000;
const RESET_HOURS = 1;
const VERIFY_HOURS = 24;
/** At most one reset or confirmation email per person per minute, so nobody can flood an inbox. */
const RESEND_GAP_MS = 60 * 1000;

/**
 * Everything around proving who you are by email: forgotten passwords,
 * confirming an address, and changing your email or password.
 */
export class AccountService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly accountTokenRepository: AccountTokenRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly emailService: EmailService,
    private readonly dashboardUrl: string,
  ) {}

  /** Emails a reset link when the account exists. Says nothing either way. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.is_active || (await this.sentRecently(user.id, 'reset_password'))) return;
    const token = await this.newToken(user.id, 'reset_password', RESET_HOURS);
    await this.emailService.queue(
      user.email,
      emailTemplates.resetPassword({ name: user.name, link: `${this.dashboardUrl}/reset-password/${token}` }, messages[user.language]),
    );
  }

  /** The emailed link proves the inbox, so it also confirms the address. Every device is logged out. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const used = await this.accountTokenRepository.consume(hashAccountToken(token), 'reset_password');
    if (!used) throw new GoneError('This reset link no longer works. Ask for a new one.');
    await this.userRepository.update(used.userId, {
      password_hash: await hashPassword(newPassword),
      email_verified_at: new Date(),
    });
    await this.refreshTokenRepository.revokeAllForUser(used.userId);
  }

  /** Emails a confirmation link to someone who hasn't confirmed yet. Says nothing either way. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || user.email_verified_at || (await this.sentRecently(user.id, 'verify_email'))) return;
    await this.sendVerification(user.id);
  }

  async sendVerification(userId: number): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    const token = await this.newToken(user.id, 'verify_email', VERIFY_HOURS);
    await this.emailService.queue(
      user.email,
      emailTemplates.verifyEmail({ name: user.name, link: `${this.dashboardUrl}/verify-email/${token}` }, messages[user.language]),
    );
  }

  async verifyEmail(token: string): Promise<void> {
    const used = await this.accountTokenRepository.consume(hashAccountToken(token), 'verify_email');
    if (!used) throw new GoneError('This link no longer works. Log in to get a new one.');
    await this.userRepository.update(used.userId, { email_verified_at: new Date() });
  }

  /** People who only use Google have no password yet and can set one without the current one. */
  async changePassword(userId: number, currentPassword: string | undefined, newPassword: string, keepSessionId?: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    if (user.password_hash && !(await verifyPassword(currentPassword ?? '', user.password_hash))) {
      throw new ValidationError('Your current password is not right');
    }
    await this.userRepository.update(user.id, { password_hash: await hashPassword(newPassword) });
    await this.refreshTokenRepository.revokeAllForUserExcept(user.id, keepSessionId);
  }

  /** Sends a link to the new address; nothing changes until it's clicked. */
  async requestEmailChange(userId: number, password: string | undefined, newEmail: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    if (user.password_hash && !(await verifyPassword(password ?? '', user.password_hash))) {
      throw new ValidationError('Your password is not right');
    }
    if (newEmail === user.email) throw new ValidationError('That is already your email');
    if (await this.userRepository.findByEmail(newEmail)) throw new ConflictError(`${newEmail} is already used by another account`);
    const token = await this.newToken(user.id, 'change_email', VERIFY_HOURS, newEmail);
    await this.emailService.queue(
      newEmail,
      emailTemplates.confirmNewEmail({ name: user.name, link: `${this.dashboardUrl}/confirm-email/${token}` }, messages[user.language]),
    );
  }

  /** Switches the login email, tells the old address, and logs out every device. */
  async confirmEmailChange(token: string): Promise<void> {
    const used = await this.accountTokenRepository.consume(hashAccountToken(token), 'change_email');
    if (!used || !used.newEmail) throw new GoneError('This link no longer works. Ask for the change again.');
    const user = await this.userRepository.findById(used.userId);
    if (!user) throw new GoneError('This link no longer works.');
    if (await this.userRepository.findByEmail(used.newEmail)) {
      throw new ConflictError(`${used.newEmail} is already used by another account`);
    }
    await this.userRepository.update(user.id, { email: used.newEmail, email_verified_at: new Date() });
    await this.emailService.queue(user.email, emailTemplates.emailChanged({ name: user.name, newEmail: used.newEmail }, messages[user.language]));
    await this.refreshTokenRepository.revokeAllForUser(user.id);
  }

  private sentRecently(userId: number, purpose: 'reset_password' | 'verify_email'): Promise<boolean> {
    return this.accountTokenRepository.sentSince(userId, purpose, new Date(Date.now() - RESEND_GAP_MS));
  }

  private async newToken(
    userId: number,
    purpose: 'reset_password' | 'verify_email' | 'change_email',
    hours: number,
    newEmail?: string,
  ): Promise<string> {
    const { token, hash } = newAccountToken();
    await this.accountTokenRepository.create({
      userId,
      purpose,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + hours * HOUR_MS),
      newEmail,
    });
    return token;
  }
}
