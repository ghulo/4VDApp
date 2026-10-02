import { createHash, randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { USER_ROLES, type UserRole } from '../database/types.js';
import type { RequestIdentity } from '../types/auth.js';

interface AccessTokenClaims {
  userId: number;
  email: string;
  role: UserRole;
  sid?: string;
}

export function signAccessToken(identity: RequestIdentity, secret: string, expiresIn: string): string {
  const claims: AccessTokenClaims = {
    userId: identity.userId,
    email: identity.email,
    role: identity.role,
    ...(identity.sessionId && { sid: identity.sessionId }),
  };
  return jwt.sign(claims, secret, {
    expiresIn: expiresIn as SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

/** Returns the identity inside a valid token, or null if it is invalid or expired. */
export function verifyAccessToken(token: string, secret: string): RequestIdentity | null {
  try {
    // Pinning the algorithm stops "alg: none" and algorithm-confusion attacks.
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return null;

    const { userId, email, role, sid } = decoded as Partial<AccessTokenClaims>;
    const isValidRole = typeof role === 'string' && (USER_ROLES as readonly string[]).includes(role);
    if (typeof userId !== 'number' || typeof email !== 'string' || !isValidRole) return null;

    return { userId, email, role: role as UserRole, ...(typeof sid === 'string' && { sessionId: sid }) };
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are random strings, not JWTs: they only mean something when
 * matched against the database, which is what lets logout revoke them.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Only the SHA-256 hash is stored, so a database leak does not leak sessions. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
