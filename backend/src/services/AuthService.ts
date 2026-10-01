import type { AppConfig } from '../config/env.js';
import { UnauthorizedError } from '../errors/httpErrors.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
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

type AuthConfig = Pick<AppConfig, 'jwtSecret' | 'jwtExpiresIn' | 'refreshTokenTtlDays'>;

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly config: AuthConfig,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.userRepository.findByEmail(email);
    const isPasswordCorrect = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

    // Same message for every failure so attackers cannot tell which part was wrong.
    if (!user || !isPasswordCorrect || !user.is_active) {
      throw new UnauthorizedError('Email or password is incorrect');
    }

    const publicUser = toPublicUser(user);
    return { ...(await this.issueTokens(publicUser)), user: publicUser };
  }

  /** Swap a refresh token for a new pair. The old refresh token stops working. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const consumed = await this.refreshTokenRepository.consumeValid(hashRefreshToken(refreshToken));
    if (!consumed) throw new UnauthorizedError('Session expired, please log in again');

    const user = await this.userRepository.findById(consumed.userId);
    if (!user || !user.is_active) throw new UnauthorizedError('Session expired, please log in again');

    return this.issueTokens(toPublicUser(user));
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

  private async issueTokens(user: PublicUser): Promise<TokenPair> {
    const token = signAccessToken(
      { userId: user.id, email: user.email, role: user.role },
      this.config.jwtSecret,
      this.config.jwtExpiresIn,
    );
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * MS_PER_DAY);
    await this.refreshTokenRepository.create(user.id, hashRefreshToken(refreshToken), expiresAt);
    return { token, refreshToken };
  }
}
