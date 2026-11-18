import { type Kysely, sql } from 'kysely';

/**
 * Each business in its own colours: the colour its owner picked (one #rrggbb;
 * the rest is worked out from it, utils/brandColours.ts), whether its greys
 * lean towards that colour, the name shown on the dashboard, sign-in, portal
 * and emails (the legal name stays on invoices), and the lines printed under
 * that name on what 4VD prints. 4VD's own business (short name '4vd') ignores
 * all of it and keeps 4VD's look.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE businesses
      ADD COLUMN brand_colour text,
      ADD COLUMN brand_greys text NOT NULL DEFAULT 'tinted',
      ADD COLUMN display_name text,
      ADD COLUMN receipt_header text,
      ADD CONSTRAINT businesses_brand_colour_format CHECK (brand_colour ~ '^#[0-9a-f]{6}$'),
      ADD CONSTRAINT businesses_brand_greys_check CHECK (brand_greys IN ('plain', 'tinted')),
      ADD CONSTRAINT businesses_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 40),
      ADD CONSTRAINT businesses_receipt_header_length CHECK (char_length(receipt_header) <= 200)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE businesses
      DROP COLUMN brand_colour,
      DROP COLUMN brand_greys,
      DROP COLUMN display_name,
      DROP COLUMN receipt_header
  `.execute(db);
}
