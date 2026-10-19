import { type Kysely, sql } from 'kysely';

/**
 * Split payment at the counter: part cash, part card in one sale. The invoice
 * stays "paid at the till" and `card_amount` says how much of it went on the
 * bank's card terminal; the rest is cash in the drawer. Null on every other
 * invoice (a card sale is all card, a till sale all cash).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE documents ADD COLUMN card_amount numeric(12, 2)`.execute(db);
  await sql`
    ALTER TABLE documents ADD CONSTRAINT documents_card_amount_check
    CHECK (card_amount IS NULL OR (card_amount > 0 AND payment_method = 'till' AND kind = 'invoice'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE documents DROP COLUMN card_amount`.execute(db);
}
