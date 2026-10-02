import type { AppConfig } from '../config/env.js';
import { UnauthorizedError } from '../errors/httpErrors.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import type { UserRow } from '../database/types.js';
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

  async login(email: string, password: string, device: DeviceInfo = {}): Promise<LoginResult> {
    const user = await this.userRepository.findByEmail(email);
    const isPasswordCorrect = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

    // Same message for every failure so attackers cannot tell which part was wrong.
    if (!user || !isPasswordCorrect || !user.is_active) {
      throw new UnauthorizedError('Email or password is incorrect');
    }
    if (!user.email_verified_at) {
      throw new UnauthorizedError('Confirm your email first: use the link we sent you');
    }
    return this.startSession(user, device);
  }

  /**
   * Log someone in whose identity was already proven (password, invite link,
   * Google). Starts a new device session.
   */
  async startSession(user: UserRow, device: DeviceInfo = {}, how = 'logged in'): Promise<LoginResult> {
    const publicUser = toPublicUser(user);
    const tokens = await this.issueTokens(publicUser, { userAgent: device.userAgent, ip: device.ip });
    await this.userRepository.update(user.id, { last_login_at: new Date() });
    // Logged once the session exists, so the log never shows a login that failed.
    await this.activityLogRepository.create({
      userId: user.id,
      action: 'auth.logged_in',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.name} ${how}`,
    });
    return { ...tokens, user: publicUser };
  }

  /** Swap a refresh token for a new pair. The old refresh token stops working. */
  async refresh(refreshToken: string, device: DeviceInfo = {}): Promise<TokenPair> {
    const consumed = await this.refreshTokenRepository.consumeValid(hashRefreshToken(refreshToken));
    if (!consumed) throw new UnauthorizedError('Session expired, please log in again');

    const user = await this.userRepository.findById(consumed.userId);
    if (!user || !user.is_active) throw new UnauthorizedError('Session expired, please log in again');

    // Same device, same session: keep its id so it stays one row in the devices list.
    return this.issueTokens(toPublicUser(user), {
      sessionId: consumed.sessionId,
      userAgent: device.userAgent ?? consumed.userAgent,
      ip: device.ip,
    });
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
    session: { sessionId?: string; userAgent?: string | null; ip?: string | null } = {},
  ): Promise<TokenPair> {
    const token = signAccessToken(
      { userId: user.id, email: user.email, role: user.role },
      this.config.jwtSecret,
      this.config.jwtExpiresIn,
    );
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * MS_PER_DAY);
    await this.refreshTokenRepository.create(user.id, hashRefreshToken(refreshToken), expiresAt, session);
    return { token, refreshToken };
  }
}
