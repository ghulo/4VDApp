import bcrypt from 'bcryptjs';

// 12 rounds takes roughly 200ms per hash: slow enough to hurt brute force,
// fast enough that logging in does not feel sluggish.
const BCRYPT_ROUNDS = 12;

export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

export function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
