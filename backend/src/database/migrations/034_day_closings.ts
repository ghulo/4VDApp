import { type Kysely, sql } from 'kysely';

/** Shop days whose "the day is closed" alert went out, so it goes out once. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE day_closings (
      day DATE PRIMARY KEY,
      announced_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE day_closings`.execute(db);
}
