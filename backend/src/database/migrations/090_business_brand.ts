import { type Kysely, sql } from 'kysely';

/**
 * Each business in its own colours (Settings → Business look):
 * - brand_colour: the main colour (#rrggbb); null = the business's default
 *   (4VD's amber for 4VD, a preset for the others). The rest of the scale is
 *   worked out from it (utils/brandColours.ts, admin theme/brandTheme.ts).
 * - brand_accent: a second colour for charts and the "where you are" marker; null = the main one.
 * - brand_gradient: main → accent on the main key, the logo key and the marker.
 * - brand_greys: plain or tinted toward the colour; null = the default (plain for 4VD, tinted for others).
 * - brand_previous: the theme before the last colour change, for "Back to previous".
 * - display_name: the name shown on the dashboard, sign-in, portal and emails (the legal name stays on invoices).
 * - receipt_header: lines printed under that name.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // businesses is tiny, but every request reads it: give up rather than queue behind a long transaction.
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`
    ALTER TABLE businesses
      ADD COLUMN brand_colour text,
      ADD COLUMN brand_accent text,
      ADD COLUMN brand_gradient boolean NOT NULL DEFAULT false,
      ADD COLUMN brand_greys text,
      ADD COLUMN brand_previous jsonb,
      ADD COLUMN display_name text,
      ADD COLUMN receipt_header text,
      ADD CONSTRAINT businesses_brand_colour_format CHECK (brand_colour ~ '^#[0-9a-f]{6}$'),
      ADD CONSTRAINT businesses_brand_accent_format CHECK (brand_accent ~ '^#[0-9a-f]{6}$'),
      ADD CONSTRAINT businesses_brand_greys_check CHECK (brand_greys IN ('plain', 'tinted')),
      ADD CONSTRAINT businesses_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 40),
      ADD CONSTRAINT businesses_receipt_header_length CHECK (char_length(receipt_header) <= 200)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE businesses
      DROP COLUMN brand_colour,
      DROP COLUMN brand_accent,
      DROP COLUMN brand_gradient,
      DROP COLUMN brand_greys,
      DROP COLUMN brand_previous,
      DROP COLUMN display_name,
      DROP COLUMN receipt_header
  `.execute(db);
}
