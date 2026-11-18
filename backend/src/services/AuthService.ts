import { randomUUID } from 'node:crypto';
import { enterBusiness } from '../database/businessContext.js';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config/env.js';
import { AppError, ForbiddenError, UnauthorizedError } from '../errors/httpErrors.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import type { UserRole, UserRow } from '../database/types.js';
import type { PublicUser } from '../types/auth.js';
import { verifyPassword } from '../utils/password.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../utils/tokens.js';
import { toPublicUser } from './mappers.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A real bcrypt hash of a random string. Comparing against it when the email
// is unknown makes "wrong email" take as long as "wrong password", so response
// times cannot be used to discover which emails have accounts.
const DUMMY_PASSWORD_HASH = '$2b$12$PqCdQl8CCdap7wsWZzUkCeJs6eE5Ci8dzpTdDG4ZKjt1pm2pgl4wi';

export interface TokenPair {
  token: string;
  refreshToken: string;
}

export interface LoginResult extends TokenPair {
  user: PublicUser;
}

/** Shown in the list of devices someone is logged in on. */
/** The password (or Google) was right, and two-step sign-in is on: a code is still needed. */
export interface TwoStepNeeded {
  twoStep: true;
  /** Good for one sign-in, a few minutes; not a session. */
  challenge: string;
}

/** Where a session works: a business and the person's role in it. */
interface Place {
  businessId: number;
  role: UserRole;
}

/** The session's business no longer has this person (blocked or taken off it). */
export const BUSINESS_GONE = 'You no longer have access to that business. Log in again.';

export const TWO_STEP_AUDIENCE = '4vd-two-step';

/**
 * The first step was right, but a manager asked this person to set two-step
 * sign-in up again: no session until they have (TwoStepService.setupConfirm).
 * Its own keys, so nothing mistakes it for a session or for the code step.
 */
export interface TwoStepSetupNeeded {
  twoStepSetup: true;
  /** Good for one setup, a few minutes; not a session. */
  setupChallenge: string;
}

export const TWO_STEP_SETUP_AUDIENCE = '4vd-two-step-setup';
const SETUP_MINUTES = 15;

/** What a first step (password, Google, passkey) leads to. */
export type SignInResult = LoginResult | TwoStepNeeded | TwoStepSetupNeeded;

/** Refused session: the person must set two-step sign-in up again first. */
export function setupNeededError(): AppError {
  return new AppError('Set up two-step sign-in again first: sign in with your password', 403, 'TWO_STEP_SETUP_NEEDED');
}
const TWO_STEP_MINUTES = 5;

export interface DeviceInfo {
  userAgent?: string | null;
  ip?: string | null;
}

type AuthConfig = Pick<AppConfig, 'jwtSecret' | 'jwtExpiresIn' | 'refreshTokenTtlDays'>;

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly activityLogRepository: ActivityLogRepository,
    private readonly config: AuthConfig,
  ) {}

  async login(email: string, password: string, device: DeviceInfo = {}): Promise<SignInResult> {
    const user = await this.userRepository.findByEmail(email);
    const isPasswordCorrect = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

    // Same message for every failure so attackers cannot tell which part was wrong.
    if (!user || !isPasswordCorrect || !user.is_active) {
      throw new UnauthorizedError('Email or password is incorrect');
    }
    if (!user.email_verified_at) {
      // Its own code, so the sign-in page can say it in the reader's language and offer the link again.
      throw new AppError('Confirm your email first: use the link we sent you', 401, 'EMAIL_NOT_CONFIRMED');
    }
    return this.signIn(user, device, 'password');
  }

  /**
   * Someone proved who they are with a password or Google: a session, or, with
   * two-step sign-in on, a short challenge for the code step (TwoStepService.finish).
   * A Counter PIN takeover or an invite starts the session straight away instead.
   * Someone a manager asked to set two-step up again gets the setup instead.
   */
  async signIn(user: UserRow, device: DeviceInfo, how: 'password' | 'google' | 'passkey'): Promise<SignInResult> {
    if (user.two_step_required) {
      const setupChallenge = jwt.sign({ uid: user.id, how }, this.config.jwtSecret, {
        audience: TWO_STEP_SETUP_AUDIENCE,
        expiresIn: `${SETUP_MINUTES}m`,
        algorithm: 'HS256',
      });
      return { twoStepSetup: true, setupChallenge };
    }
    if (!user.totp_secret || how === 'passkey') return this.startSession(user, device, how);
    const challenge = jwt.sign({ uid: user.id, how }, this.config.jwtSecret, {
      audience: TWO_STEP_AUDIENCE,
      expiresIn: `${TWO_STEP_MINUTES}m`,
      algorithm: 'HS256',
    });
    return { twoStep: true, challenge };
  }

  /**
   * Log someone in whose identity was already proven (password, invite link,
   * Google). Starts a new device session.
   */
async startSession(
    user: UserRow,
    device: DeviceInfo = {},
    how: 'password' | 'google' | 'googleFirst' | 'invite' | 'pin' | 'passkey' = 'password',
    /** The PC, when someone takes it over with a PIN; any other sign-in starts a new one. */
    deviceId: string = randomUUID(),
    /** The business to open (a PIN takeover: the Counter's business); else their home business. */
    businessId?: number,
  ): Promise<LoginResult> {
    // Every way in ends here: no session while the setup is owed (an old code-step challenge, a PIN, a passkey).
    if (user.two_step_required) throw setupNeededError();
    const place = await this.placeOf(user, businessId);
    if (businessId !== undefined && place.businessId !== businessId) throw new ForbiddenError('You are not part of this business');
    const publicUser = { ...toPublicUser(user), role: place.role };
    const tokens = await this.issueTokens(publicUser, place, { userAgent: device.userAgent, ip: device.ip, deviceId });
    // Signing in for real clears any wrong-PIN lock on the person.
    await this.userRepository.update(user.id, { last_login_at: new Date(), ...(how !== 'pin' && { pin_cleared_at: new Date() }) });
    // Logged once the session exists, so the log never shows a login that failed.
    await this.activityLogRepository.create({
      userId: user.id,
      action: 'auth.logged_in',
      entityType: 'user',
      entityId: user.id,
      say: { key: 'loggedIn', params: { name: user.name, how } },
    });
    return { ...tokens, user: publicUser };
  }

  /** Swap a refresh token for a new pair. The old refresh token stops working. */
  async refresh(refreshToken: string, device: DeviceInfo = {}): Promise<TokenPair> {
    const consumed = await this.refreshTokenRepository.consumeValid(hashRefreshToken(refreshToken));
    if (!consumed) throw new UnauthorizedError('Session expired, please log in again');

    const user = await this.userRepository.findById(consumed.userId);
    if (!user || !user.is_active) throw new UnauthorizedError('Session expired, please log in again');
    if (user.two_step_required) throw new AppError('Set up two-step sign-in again: sign in with your password', 401, 'TWO_STEP_SETUP_NEEDED');

    // Same business as before, while the person may still open it. Blocked in or taken off it:
    // signed out, so nothing carries on in another business by itself (they sign in again).
    const place = await this.placeOf(user, consumed.businessId ?? undefined);
    if (consumed.businessId !== null && place.businessId !== consumed.businessId) throw new AppError(BUSINESS_GONE, 401, 'BUSINESS_GONE');
    // Same device, same session: keep its id so it stays one row in the devices list.
    return this.issueTokens({ ...toPublicUser(user), role: place.role }, place, {
      sessionId: consumed.sessionId,
      deviceId: consumed.deviceId ?? undefined,
      userAgent: device.userAgent ?? consumed.userAgent,
      ip: device.ip,
    });
  }

  /**
   * The business picker: the same session (same device row) carries on in
   * `businessId`. Only a business the person belongs to, or any business for
   * 4VD's developer. The session's old tokens stop working.
   */
  async switchBusiness(userId: number, sessionId: string | undefined, businessId: number, device: DeviceInfo = {}): Promise<LoginResult> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.is_active) throw new UnauthorizedError('Your account is no longer active');
    const place = await this.placeOf(user, businessId);
    if (place.businessId !== businessId) throw new ForbiddenError('You are not part of that business');
    const deviceId = sessionId ? await this.refreshTokenRepository.deviceOf(sessionId) : undefined;
    if (sessionId) await this.refreshTokenRepository.revokeSession(user.id, sessionId);
    const publicUser = { ...toPublicUser(user), role: place.role };
    const tokens = await this.issueTokens(publicUser, place, { sessionId, deviceId, userAgent: device.userAgent, ip: device.ip });
    return { ...tokens, user: publicUser };
  }

  /** The businesses the person may switch to, for the picker. */
  businessesOf(user: { id: number; platformDeveloper: boolean }) {
    return this.userRepository.businessesOf({ id: user.id, is_platform_developer: user.platformDeveloper });
  }

  /**
   * Where a session works: `wanted` when the person still belongs to it (4VD's
   * developer: any business that exists), else their home business.
   */
  private async placeOf(user: UserRow, wanted?: number): Promise<Place> {
    if (user.is_platform_developer) {
      const exists = wanted !== undefined && (await this.userRepository.businessName(wanted)) !== undefined;
      return { businessId: exists ? wanted : user.business_id, role: 'developer' };
    }
    const membership = await this.userRepository.membership(user.id, user.business_id, wanted);
    return membership ?? { businessId: user.business_id, role: user.role };
  }

  /**
   * Revoke one session when a refresh token is given, otherwise every session
   * for this user (useful for "log out everywhere").
   */
  async logout(userId: number, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.refreshTokenRepository.revoke(hashRefreshToken(refreshToken), userId);
    } else {
      await this.refreshTokenRepository.revokeAllForUser(userId);
    }
  }

  private async issueTokens(
    user: PublicUser,
    place: Place,
    session: { sessionId?: string; deviceId?: string; userAgent?: string | null; ip?: string | null } = {},
  ): Promise<TokenPair> {
    const { businessId } = place;
    // From here on this request works in the session's business (the sign-in log entry, the session).
    enterBusiness(businessId);
    const sessionId = session.sessionId ?? randomUUID();
    // The role in the token is the one in this business (public pages trust it to hide costs).
    const token = signAccessToken(
      { userId: user.id, email: user.email, role: place.role, sessionId, businessId },
      this.config.jwtSecret,
      this.config.jwtExpiresIn,
    );
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * MS_PER_DAY);
    await this.refreshTokenRepository.create(user.id, hashRefreshToken(refreshToken), expiresAt, { ...session, sessionId, businessId });
    return { token, refreshToken };
  }
}
