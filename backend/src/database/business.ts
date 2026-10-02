import type { DatabaseClient } from './connection.js';

const DEFAULT_BUSINESS_NAME = '4VD';

/**
 * The shop's business record. While 4VD runs a single shop this is the only
 * one; scripts that create users without someone signed in use it. When 4VD
 * becomes a product for many shops, callers will pass the business explicitly.
 */
export async function defaultBusinessId(db: DatabaseClient): Promise<number> {
  const existing = await db.selectFrom('businesses').select('id').orderBy('id').executeTakeFirst();
  if (existing) return existing.id;
  const created = await db
    .insertInto('businesses')
    .values({ name: DEFAULT_BUSINESS_NAME })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}
