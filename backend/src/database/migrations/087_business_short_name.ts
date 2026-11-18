import { type Kysely, sql } from 'kysely';
import { toShortName } from '../../utils/shortName.js';

/**
 * Many businesses, phase 5d-2: each business gets a short name, the part after
 * the + in its own bill address (bills+<short>@4vd.app). The first business
 * is '4vd'; plain bills@4vd.app keeps going to it. Others get one made from
 * their name. Unique, so an address always names one business.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE businesses ADD COLUMN short_name text`.execute(db);
  const { rows } = await sql<{ id: number; name: string }>`SELECT id, name FROM businesses ORDER BY id`.execute(db);
  const taken = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const base = index === 0 ? '4vd' : toShortName(row.name);
    let name = base;
    for (let n = 2; taken.has(name); n += 1) name = `${base.slice(0, 27)}-${n}`;
    taken.add(name);
    await sql`UPDATE businesses SET short_name = ${name} WHERE id = ${row.id}`.execute(db);
  }
  await sql`
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_short_name_format CHECK (short_name ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
      ADD CONSTRAINT businesses_short_name_key UNIQUE (short_name)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE businesses DROP COLUMN short_name`.execute(db);
}
