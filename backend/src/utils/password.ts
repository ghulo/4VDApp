import bcrypt from 'bcryptjs';

// 12 rounds takes roughly 200ms per hash: slow enough to hurt brute force,
// fast enough that logging in does not feel sluggish.
const LIVE_ROUNDS = 12;

/**
 * The work factor for new hashes. Under the test runner the lowest cost: tests sign in about a
 * thousand times, at about 440ms each in this pure-JS bcrypt. The checks are the same; only the
 * work factor stored in the hash differs. Never in production, even if VITEST were set there.
 */
export function bcryptRounds(env: NodeJS.ProcessEnv = process.env): number {
  return env.VITEST && env.NODE_ENV !== 'production' ? 4 : LIVE_ROUNDS;
}

const BCRYPT_ROUNDS = bcryptRounds();

export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

export function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
