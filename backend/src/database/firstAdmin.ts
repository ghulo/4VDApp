import { defaultBusinessId } from './business.js';
import type { DatabaseClient } from './connection.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../utils/password.js';
import { logger } from '../utils/logger.js';

export interface FirstAdminInput {
  email?: string;
  password?: string;
  name?: string;
}

/**
 * On a brand-new server with nobody who can log in, create the owner's
 * account from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Hosts like Render's
 * free plan have no shell, and many networks block direct database access,
 * so this is the simplest way in. Once any admin exists it does nothing,
 * and the settings can (and should) be removed.
 */
export async function ensureFirstAdmin(db: DatabaseClient, input: FirstAdminInput): Promise<'created' | 'skipped'> {
  const email = input.email?.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) return 'skipped';

  const anyAdmin = await db
    .selectFrom('users')
    .select('id')
    .where('role', 'in', ['developer', 'admin'])
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (anyAdmin) {
    logger.info('An admin already exists; SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD can be removed from the settings');
    return 'skipped';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    logger.error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters; no admin was created`);
    return 'skipped';
  }

  await db
    .insertInto('users')
    .values({
      email,
      name: input.name?.trim() || 'Admin',
      role: 'developer',
      password_hash: await hashPassword(password),
      business_id: await defaultBusinessId(db),
      email_verified_at: new Date(),
    })
    .onConflict((oc) => oc.column('email').doNothing())
    .execute();
  logger.info('Created the first admin account', { email });
  return 'created';
}
