import { type Kysely, sql } from 'kysely';

/**
 * Settings → Import: a business brings its data in from another program by itself.
 *
 * - import_batches: one import. It starts as files being read ("reading"), waits
 *   for the person to check it ("ready"), runs ("running") and ends "done" or
 *   "failed"; undo turns it "undone" or "partly_undone". `draft` holds what was
 *   read from the files (records, notes, matches) until it is undone or
 *   discarded; `choices` what the person picked for each problem.
 * - import_batch_rows: every row an import created or changed, so undo can
 *   remove exactly those (created) or put the old values back (updated,
 *   `before`); `after` is what the import wrote, to tell whether someone has
 *   changed the row since.
 * - import_layouts: which column holds what in a file 4VD didn't know, kept per
 *   business by the file's headings, so the next file like it is read by itself.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE import_batches (
      id SERIAL PRIMARY KEY,
      business_id INT NOT NULL DEFAULT current_business_id() REFERENCES businesses(id),
      status TEXT NOT NULL DEFAULT 'reading'
        CHECK (status IN ('reading', 'ready', 'running', 'done', 'failed', 'undone', 'partly_undone', 'discarded')),
      source TEXT NOT NULL DEFAULT 'sheet',
      file_names TEXT[] NOT NULL DEFAULT '{}',
      draft JSONB,
      choices JSONB NOT NULL DEFAULT '{}',
      summary JSONB,
      error TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      undone_at TIMESTAMPTZ,
      undone_by INT REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX import_batches_business_created ON import_batches (business_id, created_at DESC)`.execute(db);

  await sql`
    CREATE TABLE import_batch_rows (
      id BIGSERIAL PRIMARY KEY,
      business_id INT NOT NULL DEFAULT current_business_id() REFERENCES businesses(id),
      batch_id INT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_id INT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'updated')),
      before JSONB,
      after JSONB,
      undone_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`CREATE INDEX import_batch_rows_batch ON import_batch_rows (batch_id)`.execute(db);
  await sql`CREATE INDEX import_batch_rows_row ON import_batch_rows (table_name, row_id)`.execute(db);

  await sql`
    CREATE TABLE import_layouts (
      id SERIAL PRIMARY KEY,
      business_id INT NOT NULL DEFAULT current_business_id() REFERENCES businesses(id),
      signature TEXT NOT NULL,
      kind TEXT NOT NULL,
      header_row INT NOT NULL,
      mapping JSONB NOT NULL,
      updated_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (business_id, signature)
    )
  `.execute(db);

  await sql`SELECT protect_business_table('import_batches')`.execute(db);
  await sql`SELECT protect_business_table('import_batch_rows')`.execute(db);
  await sql`SELECT protect_business_table('import_layouts')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE import_layouts`.execute(db);
  await sql`DROP TABLE import_batch_rows`.execute(db);
  await sql`DROP TABLE import_batches`.execute(db);
}
