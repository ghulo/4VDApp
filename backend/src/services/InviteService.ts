import type { StoredRole } from '../database/types.js';
import { currentBusinessId, enterBusiness, runAsBusiness } from '../database/businessContext.js';
import { AppError, ConflictError, ForbiddenError, GoneError, NotFoundError } from '../errors/httpErrors.js';
import type { InviteRecord, InviteRepository } from '../repositories/InviteRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { EMAIL_TAKEN, type UserRepository } from '../repositories/UserRepository.js';
import { hashAccountToken, newAccountToken } from '../utils/accountTokens.js';
import { hashPassword } from '../utils/password.js';
import type { AuthService, DeviceInfo, LoginResult } from './AuthService.js';
import type { EmailService } from './email/EmailService.js';
import { emailTemplates } from './email/templates.js';
import { canHandOut } from '../utils/roles.js';
import type { Language } from '../i18n/language.js';
import { messages } from '../i18n/messages.js';
import { brandOf, type BrandDto } from './brand.js';

const INVITE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LINK_GONE = 'This invite link no longer works. Ask the shop owner to send you a new one.';

export interface InviteDto {
  id: number;
  email: string;
  role: StoredRole;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
  /** The language the invite was sent in: the WhatsApp text goes out in it too. */
  language: Language;
}

/** Right after sending: the link itself, so the inviter can also send it on WhatsApp or copy it. */
export interface SentInviteDto extends InviteDto {
  link: string;
}

export interface InvitePreviewDto {
  email: string;
  role: StoredRole;
  shopName: string;
  /** The business's look: the invite page shows its name, logo and colours. */
  brand: BrandDto;
  invitedBy: string | null;
  /** The language the invite was sent in; the invite page opens in it. */
  language: Language;
  /** The email already has a 4VD account: they sign in and join instead of choosing a password. */
  hasAccount: boolean;
}

const toDto = (invite: InviteRecord): InviteDto => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  invitedBy: invite.invited_by_name,
  expiresAt: invite.expires_at.toISOString(),
  createdAt: invite.created_at.toISOString(),
  language: invite.language,
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
    const { businessId } = await this.actor(actorId);
    return (await this.inviteRepository.findPending(businessId, new Date())).map(toDto);
  }

  /** A new invite replaces any open one to the same email. */
  async invite(actorId: number, email: string, role: StoredRole, language?: Language): Promise<SentInviteDto> {
    const { actor, businessId } = await this.actor(actorId);
    const inviteLanguage = language ?? actor.language;
    if (!canHandOut(actor.is_platform_developer ? 'developer' : actor.role, role)) throw new ForbiddenError('Only a main admin can invite a main admin, owner, admin or accountant');
    // Someone with an account in another business may be invited too (they join with it);
    // whether they have one isn't said here, only to the person holding the link.
    if (await this.userRepository.personByEmail(email)) {
      throw new ConflictError(`${email} already works here`);
    }
    const { token, hash } = newAccountToken();
    const business = await this.businessName(businessId);

    const id = await this.transactions.run(async (repos) => {
      await repos.invites.revokeOpenFor(businessId, email);
      const inviteId = await repos.invites.create({
        businessId,
        email,
        role,
        language: inviteLanguage,
        tokenHash: hash,
        invitedBy: actor.id,
        expiresAt: this.expiry(),
      });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'user.invited',
        entityType: 'user',
        entityId: null,
        say: { key: 'invited', params: { email, role } },
      });
      return inviteId;
    });
    await this.emailService.queue(
      email,
      emailTemplates.invite({ shopName: business, inviterName: actor.name, role, link: this.link(token) }, messages[inviteLanguage]),
    );
    return { ...toDto((await this.inviteRepository.findById(id, businessId))!), link: this.link(token) };
  }

  /** Sends a fresh link; the old one stops working. */
  async resend(actorId: number, inviteId: number): Promise<SentInviteDto> {
    const { actor, businessId } = await this.actor(actorId);
    const invite = await this.inviteRepository.findById(inviteId, businessId);
    if (!invite || invite.accepted_at || invite.revoked_at) throw new NotFoundError('That invite is no longer open');
    const { token, hash } = newAccountToken();
    await this.inviteRepository.replaceToken(invite.id, hash, this.expiry());
    await this.emailService.queue(
      invite.email,
      emailTemplates.invite(
        { shopName: invite.business_name, inviterName: actor.name, role: invite.role, link: this.link(token) },
        messages[invite.language],
      ),
    );
    return { ...toDto((await this.inviteRepository.findById(invite.id, businessId))!), link: this.link(token) };
  }

  async cancel(actorId: number, inviteId: number): Promise<void> {
    const { businessId } = await this.actor(actorId);
    const invite = await this.inviteRepository.findById(inviteId, businessId);
    if (!invite) throw new NotFoundError('That invite does not exist');
    await this.inviteRepository.revoke(invite.id);
  }

  /** What the invite page shows before someone accepts. */
  async preview(token: string): Promise<InvitePreviewDto> {
    const invite = await this.openInvite(token);
    return {
      email: invite.email,
      role: invite.role,
      shopName: inviteBrand(invite).name,
      brand: inviteBrand(invite),
      invitedBy: invite.invited_by_name,
      language: invite.language,
      // Read before sign-in (system mode), so accounts of every business count.
      hasAccount: (await this.userRepository.findByEmail(invite.email)) !== undefined,
    };
  }

  async accept(
    token: string,
    input: { name: string; password: string; language?: Language },
    device: DeviceInfo,
  ): Promise<LoginResult> {
    const invite = await this.openInvite(token);
    const user = await this.createMember(invite, {
      name: input.name,
      passwordHash: await hashPassword(input.password),
      language: input.language,
    });
    return this.authService.startSession(user, device, 'invite');
  }

  /** The invite behind a link, if it can still be used. Shared with Google sign-in. */
  async openInvite(token: string): Promise<InviteRecord> {
    const invite = await this.inviteRepository.findByTokenHash(hashAccountToken(token));
    if (!invite || invite.accepted_at || invite.revoked_at || invite.expires_at <= new Date()) {
      throw new GoneError(LINK_GONE);
    }
    return invite;
  }

  /**
   * Turns an open invite into a verified account. Shared with Google sign-in.
   * The language the invite page was shown in wins over the invite's own.
   */
  async createMember(invite: InviteRecord, details: { name: string; passwordHash: string | null; language?: Language }) {
    // Checked before entering the business: there, accounts of other businesses are hidden.
    const existing = await this.userRepository.findAnyByEmail(invite.email);
    if (existing && (existing.deleted_at === null || existing.is_platform_developer)) throw hasAccount(invite.email);
    if (existing) return this.revive(existing.id, invite, details);
    enterBusiness(invite.business_id);
    return this.transactions.run(async (repos) => {
      if (!(await repos.invites.markAccepted(invite.id))) throw new GoneError(LINK_GONE);
      const user = await repos.users.create({
        email: invite.email,
        name: details.name,
        role: invite.role,
        language: details.language ?? invite.language,
        password_hash: details.passwordHash,
        business_id: invite.business_id,
        email_verified_at: new Date(),
      }).catch((error: unknown) => {
        // Someone took the email between the check and now: never a 500.
        if (error instanceof AppError && error.code === EMAIL_TAKEN) throw hasAccount(invite.email);
        throw error;
      });
      await this.logJoined(repos, user, invite);
      return user;
    });
  }

  /**
   * The invited email belonged to an account that was deleted: it comes back as
   * a fresh start in the invite's business only (see UserRepository.revive).
   * The business's history says they joined, like anyone new.
   */
  private async revive(userId: number, invite: InviteRecord, details: { name: string; passwordHash: string | null; language?: Language }) {
    const everywhere = new Set([...(await this.userRepository.everyBusinessOf(userId)), invite.business_id]);
    // Before entering the business: the deleted account's row belongs to its old one.
    const user = await this.transactions.run(async (repos) => {
      if (!(await repos.invites.markAccepted(invite.id))) throw new GoneError(LINK_GONE);
      const revived = await repos.users.revive(userId, {
        name: details.name,
        passwordHash: details.passwordHash,
        role: invite.role,
        language: details.language ?? invite.language,
        businessId: invite.business_id,
      });
      if (!revived) throw hasAccount(invite.email);
      return revived;
    });
    // Its own leftovers (favourites, notifications, report emails, assistant chats) go in every business it was in,
    // so joining an old business again later never brings them back.
    for (const businessId of everywhere) {
      await runAsBusiness(businessId, () => this.transactions.run((repos) => repos.users.forgetPersonalHere(user.id)));
    }
    enterBusiness(invite.business_id);
    await this.transactions.run((repos) => this.logJoined(repos, user, invite));
    return user;
  }

  private logJoined(repos: Parameters<Parameters<TransactionManager['run']>[0]>[0], user: { id: number; name: string; email: string; role: StoredRole }, invite: InviteRecord) {
    return repos.activityLog.create({
      userId: user.id,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      say: { key: 'joined', params: { name: user.name, role: user.role } },
      details: { email: user.email, role: user.role, invitedBy: invite.invited_by_name },
    });
  }

  /**
   * Someone who already has an account (in another business) accepts: signed in
   * as the invited email, they join with their account as it is (no new
   * password or name), and the session moves into the business they joined.
   */
  async join(userId: number, token: string, sessionId: string | undefined, device: DeviceInfo): Promise<LoginResult> {
    const invite = await this.openInvite(token);
    const user = await this.userRepository.findById(userId);
    if (!user || user.email !== invite.email.toLowerCase()) {
      throw new ForbiddenError(`This invite is for ${invite.email}. Log in with that account to join.`);
    }
    // 4VD's developer opens every business already; a membership would hide his visits from the customer.
    if (user.is_platform_developer) throw new ForbiddenError("4VD's developer doesn't join businesses");
    await runAsBusiness(invite.business_id, () =>
      this.transactions.run(async (repos) => {
        if (!(await repos.invites.markAccepted(invite.id))) throw new GoneError(LINK_GONE);
        await repos.users.join(user.id, invite.business_id, invite.role);
        await repos.activityLog.create({
          userId: user.id,
          action: 'user.joined',
          entityType: 'user',
          entityId: user.id,
          say: { key: 'joined', params: { name: user.name, role: invite.role } },
          details: { email: user.email, role: invite.role, invitedBy: invite.invited_by_name },
        });
      }),
    );
    return this.authService.switchBusiness(user.id, sessionId, invite.business_id, device);
  }

  /** The person acting, with their role in the business open now. */
  private async actor(actorId: number) {
    const { actor } = await this.userRepository.inThisBusiness(actorId, actorId);
    const businessId = currentBusinessId();
    if (!actor || businessId === null) throw new NotFoundError(`User ${actorId} does not exist`);
    return { actor, businessId };
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

function hasAccount(email: string): AppError {
  return new AppError(`${email} already has a 4VD account. Log in with it, then open this link again to join.`, 409, 'INVITE_HAS_ACCOUNT');
}

/** The look of the business an invite is for. */
const inviteBrand = (invite: InviteRecord): BrandDto => brandOf({ ...invite, name: invite.business_name });
