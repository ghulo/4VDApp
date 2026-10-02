import { createHash, randomBytes } from 'node:crypto';

/**
 * Links sent by email (invites, resets, email checks) carry a random token.
 * Only its SHA-256 hash is stored, so someone who reads the database can't use
 * the links; 32 random bytes can't be guessed.
 */
export function newAccountToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAccountToken(token) };
}

export function hashAccountToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
