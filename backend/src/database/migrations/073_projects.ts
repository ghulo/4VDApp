import { type Kysely, sql } from 'kysely';

const TAGGED = ['supplier_bills', 'documents', 'stock_documents', 'write_offs'];

/**
 * Projects: a job, an event or a renovation whose income and costs the owner
 * wants to see apart. A project is a tag on supplier bills and expenses, sales
 * invoices, stock out documents and write-offs; the Profit by project report
 * adds them up from those documents (not from the books), so tagging or
 * re-tagging never touches a posted entry or a filed VAT month. A closed
 * project stays on its documents but is no longer offered in the pickers.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      note TEXT,
      closed_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX projects_name_idx ON projects (lower(name))`.execute(db);
  for (const table of TAGGED) {
    await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN project_id INT REFERENCES projects(id)`.execute(db);
    await sql`CREATE INDEX ${sql.raw(`${table}_project_idx`)} ON ${sql.table(table)} (project_id) WHERE project_id IS NOT NULL`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of TAGGED) await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS project_id`.execute(db);
  await sql`DROP TABLE IF EXISTS projects`.execute(db);
}
