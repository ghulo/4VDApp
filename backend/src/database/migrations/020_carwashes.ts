import { type Kysely, sql } from 'kysely';

/**
 * Several carwashes. Until now the business had one, so takings, cash counts
 * and expenses never said which. Now each carwash is a row, and everything
 * that was entered before belongs to the first one ("Carwash", renamed in
 * Settings). Its cash float moves from the settings list onto the carwash.
 *
 * - carwash_days: one row per carwash and day (was one per day).
 * - cash_counts: a carwash count says which carwash; the shop's has none.
 * - expenses and repeating expenses: "carwash" ones say which carwash.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE carwashes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      cash_float NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cash_float >= 0),
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  // Two open carwashes can't share a name, but an archived one's name can be used again.
  await sql`CREATE UNIQUE INDEX carwashes_open_name_idx ON carwashes (lower(name)) WHERE archived_at IS NULL`.execute(db);
  await sql`
    INSERT INTO carwashes (name, cash_float)
    VALUES ('Carwash', coalesce((SELECT (value #>> '{}')::numeric FROM settings WHERE key = 'cash_float_carwash'), 0))
  `.execute(db);
  await sql`DELETE FROM settings WHERE key = 'cash_float_carwash'`.execute(db);

  await sql`ALTER TABLE carwash_days ADD COLUMN carwash_id INT REFERENCES carwashes(id)`.execute(db);
  await sql`UPDATE carwash_days SET carwash_id = (SELECT min(id) FROM carwashes)`.execute(db);
  await sql`ALTER TABLE carwash_days ALTER COLUMN carwash_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE carwash_days DROP CONSTRAINT carwash_days_pkey`.execute(db);
  await sql`ALTER TABLE carwash_days ADD PRIMARY KEY (carwash_id, day)`.execute(db);

  await sql`ALTER TABLE cash_counts ADD COLUMN carwash_id INT REFERENCES carwashes(id)`.execute(db);
  await sql`UPDATE cash_counts SET carwash_id = (SELECT min(id) FROM carwashes) WHERE place = 'carwash'`.execute(db);
  await sql`ALTER TABLE cash_counts ADD CHECK ((place = 'carwash') = (carwash_id IS NOT NULL))`.execute(db);
  await sql`ALTER TABLE cash_counts DROP CONSTRAINT cash_counts_place_day_key`.execute(db);
  // The shop has no carwash, and for this rule two empty ones count as the same.
  await sql`ALTER TABLE cash_counts ADD CONSTRAINT cash_counts_drawer_day_key UNIQUE NULLS NOT DISTINCT (place, carwash_id, day)`.execute(db);

  for (const table of ['expenses', 'recurring_expenses']) {
    await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN carwash_id INT REFERENCES carwashes(id)`.execute(db);
    await sql`UPDATE ${sql.table(table)} SET carwash_id = (SELECT min(id) FROM carwashes) WHERE place = 'carwash'`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} ADD CHECK ((place = 'carwash') = (carwash_id IS NOT NULL))`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['expenses', 'recurring_expenses']) {
    await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS carwash_id`.execute(db);
  }
  await sql`ALTER TABLE cash_counts DROP CONSTRAINT IF EXISTS cash_counts_drawer_day_key`.execute(db);
  // Several carwashes' counts for one day can't all stay; the oldest count of each day is kept.
  await sql`DELETE FROM cash_counts a USING cash_counts b WHERE a.place = 'carwash' AND b.place = 'carwash' AND a.day = b.day AND a.id > b.id`.execute(db);
  await sql`ALTER TABLE cash_counts DROP COLUMN IF EXISTS carwash_id`.execute(db);
  await sql`ALTER TABLE cash_counts ADD CONSTRAINT cash_counts_place_day_key UNIQUE (place, day)`.execute(db);

  // Back to one row per day: the carwashes' takings are added together.
  await sql`
    CREATE TABLE carwash_days_merged AS
    SELECT day, sum(carwash_amount) AS carwash_amount, sum(change_amount) AS change_amount,
           (array_agg(recorded_by))[1] AS recorded_by, max(updated_at) AS updated_at
    FROM carwash_days GROUP BY day
  `.execute(db);
  await sql`DROP TABLE carwash_days`.execute(db);
  await sql`ALTER TABLE carwash_days_merged RENAME TO carwash_days`.execute(db);
  await sql`ALTER TABLE carwash_days ADD PRIMARY KEY (day)`.execute(db);

  await sql`DROP TABLE IF EXISTS carwashes`.execute(db);
}
