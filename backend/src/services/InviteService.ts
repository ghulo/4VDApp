import type { UserRole } from '../database/types.js';
import { ConflictError, GoneError, NotFoundError } from '../errors/httpErrors.js';
import type { InviteRecord, InviteRepository } from '../repositories/InviteRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { hashAccountToken, newAccountToken } from '../utils/accountTokens.js';
import { hashPassword } from '../utils/password.js';
import type { AuthService, DeviceInfo, LoginResult } from './AuthService.js';
import type { EmailService } from './email/EmailService.js';
import { emailTemplates } from './email/templates.js';

const INVITE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LINK_GONE = 'This invite link no longer works. Ask the shop owner to send you a new one.';

export interface InviteDto {
  id: number;
  email: string;
  role: UserRole;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface InvitePreviewDto {
  email: string;
  role: UserRole;
  shopName: string;
  invitedBy: string | null;
}

const toDto = (invite: InviteRecord): InviteDto => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  invitedBy: invite.invited_by_name,
  expiresAt: invite.expires_at.toISOString(),
  createdAt: invite.created_at.toISOString(),
});

/**
 * The owner invites people by email; the link lets them choose a password and
 * become a verified member of the shop. Clicking the emailed link is what
 * proves the address, so accepted accounts start out verified.
 */
export class InviteService {
  constructor(
    private readonly inviteRepository: InviteRepository,
    private readonly userRepository: UserRepository,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly transactions: TransactionManager,
    private readonly dashboardUrl: string,
  ) {}

  async list(actorId: number): Promise<InviteDto[]> {
    const actor = await this.actor(actorId);
    return (await this.inviteRepository.findPending(actor.business_id, new Date())).map(toDto);
  }

  /** A new invite replaces any open one to the same email. */
  async invite(actorId: number, email: string, role: UserRole): Promise<InviteDto> {
    const actor = await this.actor(actorId);
    if (await this.userRepository.findByEmail(email)) {
      throw new ConflictError(`${email} already has an account`);
    }
    const { token, hash } = newAccountToken();
    const business = await this.businessName(actor.business_id);

    const id = await this.transactions.run(async (repos) => {
      await repos.invites.revokeOpenFor(actor.business_id, email);
      const inviteId = await repos.invites.create({
        businessId: actor.business_id,
        email,
        role,
        tokenHash: hash,
        invitedBy: actor.id,
        expiresAt: this.expiry(),
      });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'user.invited',
        entityType: 'user',
        entityId: null,
        summary: `Invited ${email} as ${role}`,
      });
      return inviteId;
    });
    await this.emailService.queue(
      email,
      emailTemplates.invite({ shopName: business, inviterName: actor.name, role, link: this.link(token) }),
    );
    return toDto((await this.inviteRepository.findById(id, actor.business_id))!);
  }

  /** Sends a fresh link; the old one stops working. */
  async resend(actorId: number, inviteId: number): Promise<InviteDto> {
    const actor = await this.actor(actorId);
    const invite = await this.inviteRepository.findById(inviteId, actor.business_id);
    if (!invite || invite.accepted_at || invite.revoked_at) throw new NotFoundError('That invite is no longer open');
    const { token, hash } = newAccountToken();
    await this.inviteRepository.replaceToken(invite.id, hash, this.expiry());
    await this.emailService.queue(
      invite.email,
      emailTemplates.invite({ shopName: invite.business_name, inviterName: actor.name, role: invite.role, link: this.link(token) }),
    );
    return toDto((await this.inviteRepository.findById(invite.id, actor.business_id))!);
  }

  async cancel(actorId: number, inviteId: number): Promise<void> {
    const actor = await this.actor(actorId);
    const invite = await this.inviteRepository.findById(inviteId, actor.business_id);
    if (!invite) throw new NotFoundError('That invite does not exist');
    await this.inviteRepository.revoke(invite.id);
  }

  /** What the invite page shows before someone accepts. */
  async preview(token: string): Promise<InvitePreviewDto> {
    const invite = await this.openInvite(token);
    return { email: invite.email, role: invite.role, shopName: invite.business_name, invitedBy: invite.invited_by_name };
  }

  async accept(token: string, input: { name: string; password: string }, device: DeviceInfo): Promise<LoginResult> {
    const invite = await this.openInvite(token);
    const user = await this.createMember(invite, { name: input.name, passwordHash: await hashPassword(input.password) });
    return this.authService.startSession(user, device, 'joined from an invite');
  }

  /** The invite behind a link, if it can still be used. Shared with Google sign-in. */
  async openInvite(token: string): Promise<InviteRecord> {
    const invite = await this.inviteRepository.findByTokenHash(hashAccountToken(token));
    if (!invite || invite.accepted_at || invite.revoked_at || invite.expires_at <= new Date()) {
      throw new GoneError(LINK_GONE);
    }
    return invite;
  }

  /** Turns an open invite into a verified account. Shared with Google sign-in. */
  async createMember(invite: InviteRecord, details: { name: string; passwordHash: string | null }) {
    if (await this.userRepository.findByEmail(invite.email)) {
      throw new ConflictError(`${invite.email} already has an account. Log in instead.`);
    }
    return this.transactions.run(async (repos) => {
      if (!(await repos.invites.markAccepted(invite.id))) throw new GoneError(LINK_GONE);
      const user = await repos.users.create({
        email: invite.email,
        name: details.name,
        role: invite.role,
        password_hash: details.passwordHash,
        business_id: invite.business_id,
        email_verified_at: new Date(),
      });
      await repos.activityLog.create({
        userId: user.id,
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        summary: `${user.name} joined as ${user.role}`,
        details: { email: user.email, role: user.role, invitedBy: invite.invited_by_name },
      });
      return user;
    });
  }

  private async actor(actorId: number) {
    const actor = await this.userRepository.findById(actorId);
    if (!actor) throw new NotFoundError(`User ${actorId} does not exist`);
    return actor;
  }

  private async businessName(businessId: number): Promise<string> {
    return (await this.userRepository.businessName(businessId)) ?? '4VD';
  }

  private expiry(): Date {
    return new Date(Date.now() + INVITE_DAYS * MS_PER_DAY);
  }

  private link(token: string): string {
    return `${this.dashboardUrl}/invite/${token}`;
  }
}
