import { defaultBusinessId } from '../database/business.js';
import type { AppConfig } from '../config/env.js';
import type { DatabaseClient } from '../database/connection.js';
import type { UserRole } from '../database/types.js';
import { hashPassword } from '../utils/password.js';
import { logger } from '../utils/logger.js';

/**
 * Accounts for trying the apps on a local database, one per role. The
 * passwords are deliberately public, which is why seeding them is refused
 * on a production database.
 */
export const DEMO_ACCOUNTS: ReadonlyArray<{ email: string; password: string; name: string; role: UserRole }> = [
  { email: 'demo-admin@4vd.local', password: 'demo-admin-4vd', name: 'Demo Admin', role: 'admin' },
  { email: 'demo-employee@4vd.local', password: 'demo-employee-4vd', name: 'Demo Employee', role: 'employee' },
  { email: 'demo-family@4vd.local', password: 'demo-family-4vd', name: 'Demo Family', role: 'family' },
];

/** Create the demo accounts, or reset them (password, role, active) if they already exist. */
export async function seedDemoAccounts(db: DatabaseClient, nodeEnv: AppConfig['nodeEnv']): Promise<void> {
  if (nodeEnv === 'production') {
    throw new Error('Demo accounts have public passwords and are never created on a production database');
  }
  for (const account of DEMO_ACCOUNTS) {
    const values = {
      name: account.name,
      role: account.role,
      is_active: true,
      deleted_at: null,
      password_hash: await hashPassword(account.password),
      email_verified_at: new Date(),
    };
    await db
      .insertInto('users')
      .values({ email: account.email, business_id: await defaultBusinessId(db), ...values })
      .onConflict((oc) => oc.column('email').doUpdateSet(values))
      .execute();
  }
  logger.info('Demo accounts ready', { emails: DEMO_ACCOUNTS.map((account) => account.email) });
}
