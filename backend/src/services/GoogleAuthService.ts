import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/httpErrors.js';
import type { UserIdentityRepository } from '../repositories/UserIdentityRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import type { AuthService, DeviceInfo, LoginResult } from './AuthService.js';
import type { GoogleVerifier } from './google/googleVerifier.js';
import type { InviteService } from './InviteService.js';

const NO_ACCOUNT = 'No 4VD account uses this Google email. Ask the shop owner for an invite.';

export interface SecurityDto {
  hasPassword: boolean;
  /** The Google account linked for signing in, if any. */
  googleEmail: string | null;
}

/**
 * Sign in with Google. It never creates an account by itself: it signs in an
 * account already linked to this Google account, links one on first use when
 * Google has verified the same email, or accepts an invite sent to that email.
 */
export class GoogleAuthService {
  constructor(
    private readonly verifier: GoogleVerifier | null,
    readonly clientId: string | null,
    private readonly identities: UserIdentityRepository,
    private readonly userRepository: UserRepository,
    private readonly authService: AuthService,
    private readonly inviteService: InviteService,
  ) {}

  status(): { enabled: boolean; clientId: string | null } {
    return { enabled: this.verifier !== null, clientId: this.verifier ? this.clientId : null };
  }

  async signIn(credential: string, device: DeviceInfo): Promise<LoginResult> {
    const profile = await this.verify(credential);
    const linkedUserId = await this.identities.findUserId('google', profile.subject);
    let user = linkedUserId ? await this.userRepository.findById(linkedUserId) : undefined;

    if (!user) {
      if (!profile.emailVerified) throw new UnauthorizedError(NO_ACCOUNT);
      user = await this.userRepository.findByEmail(profile.email);
      if (!user) throw new UnauthorizedError(NO_ACCOUNT);
      await this.identities.link(user.id, 'google', profile.subject, profile.email);
      // Google vouches for the address, which is as good as our confirmation link.
      if (!user.email_verified_at) user = (await this.userRepository.update(user.id, { email_verified_at: new Date() }))!;
    }
    if (!user.is_active) throw new UnauthorizedError('Your account is no longer active');
    return this.authService.startSession(user, device, 'logged in with Google');
  }

  /** Accept an invite with the Google account it was sent to; no password needed. */
  async acceptInvite(inviteToken: string, credential: string, device: DeviceInfo): Promise<LoginResult> {
    const profile = await this.verify(credential);
    const invite = await this.inviteService.openInvite(inviteToken);
    if (!profile.emailVerified || profile.email !== invite.email) {
      throw new ForbiddenError(`This invite is for ${invite.email}. Use the Google account with that email, or choose a password.`);
    }
    const user = await this.inviteService.createMember(invite, { name: profile.name, passwordHash: null });
    await this.identities.link(user.id, 'google', profile.subject, profile.email);
    return this.authService.startSession(user, device, 'logged in with Google for the first time');
  }

  async security(userId: number): Promise<SecurityDto> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    return { hasPassword: user.password_hash !== null, googleEmail: await this.identities.emailFor(userId, 'google') };
  }

  async unlink(userId: number): Promise<SecurityDto> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    if (!user.password_hash) {
      throw new ConflictError('Set a password first, or you would have no way to log in.');
    }
    await this.identities.unlink(userId, 'google');
    return this.security(userId);
  }

  private async verify(credential: string) {
    if (!this.verifier) throw new NotFoundError('Google sign-in is not set up');
    return this.verifier.verify(credential);
  }
}
