import { type Kysely, sql } from 'kysely';
import { runAsBusiness } from '../businessContext.js';

/**
 * How a refund's money goes back. Until now every refund came out of the till
 * (less what came off a customer's tab). Now each return says:
 *
 * - refund_card: given back on the card terminal, so it comes off the card
 *   money in the bank, not the drawer. card_approval_code: the code on the
 *   terminal's slip, when staff typed it.
 * - refund_transfer: sent by bank transfer. It is owed to the customer
 *   (refund_to, refund_iban) until someone marks it sent (transfer_sent_*),
 *   then it leaves that place (the bank, usually).
 * - refund_tab: what should come off their tab; null on returns from before,
 *   which keep the old rule (off the tab first, up to what they owe).
 * - the rest is cash out of the till.
 * - refund_batch: the lines given back together, so a refund over several
 *   lines shows as one payment to make.
 *
 * The books get one account link, refunds_owed (2430, other short-term
 * liabilities), for refunds owed to customers until sent; each business gets
 * it here. Default until the accountant confirms (handoff.md).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`
    ALTER TABLE returns
      ADD COLUMN refund_card NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (refund_card >= 0),
      ADD COLUMN refund_transfer NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (refund_transfer >= 0),
      ADD COLUMN refund_tab NUMERIC(12, 2) CHECK (refund_tab >= 0),
      ADD COLUMN card_approval_code VARCHAR(40),
      ADD COLUMN refund_to VARCHAR(200),
      ADD COLUMN refund_iban VARCHAR(40),
      ADD COLUMN refund_batch UUID,
      ADD COLUMN transfer_sent_on DATE,
      ADD COLUMN transfer_sent_from INT REFERENCES money_places(id),
      ADD COLUMN transfer_sent_by INT REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN transfer_sent_at TIMESTAMPTZ,
      ADD CONSTRAINT returns_refund_parts CHECK (refund_card + refund_transfer + coalesce(refund_tab, 0) <= refund_amount),
      ADD CONSTRAINT returns_transfer_to CHECK (refund_transfer = 0 OR refund_to IS NOT NULL),
      ADD CONSTRAINT returns_transfer_sent CHECK ((transfer_sent_on IS NULL) = (transfer_sent_from IS NULL))
  `.execute(db);
  // The "to pay back" list in Money: approved transfers not sent yet.
  await sql`CREATE INDEX returns_transfer_owed_idx ON returns (business_id) WHERE refund_transfer > 0 AND transfer_sent_on IS NULL`.execute(db);

  // Each business's books, inside that business (so the business guard stays quiet).
  const { rows: businesses } = await sql<{ id: number }>`SELECT id FROM businesses ORDER BY id`.execute(db);
  for (const { id } of businesses) {
    await runAsBusiness(id, async () => {
      await sql`
        INSERT INTO ledger_links (business_id, key, account_id)
        SELECT ${id}, 'refunds_owed', a.id FROM ledger_accounts a WHERE a.number = '2430' AND a.business_id = ${id}
        ON CONFLICT (business_id, key) DO NOTHING
      `.execute(db);
      // A business with books must have the link, or nothing posts there any more.
      const { rows } = await sql<{ books: boolean; linked: boolean }>`
        SELECT EXISTS (SELECT 1 FROM ledger_links WHERE business_id = ${id}) AS books,
          EXISTS (SELECT 1 FROM ledger_links WHERE business_id = ${id} AND key = 'refunds_owed') AS linked
      `.execute(db);
      if (rows[0]!.books && !rows[0]!.linked) throw new Error(`Account 2430 is missing in the books of business ${id}; add it before migrating`);
    });
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const { rows: businesses } = await sql<{ id: number }>`SELECT id FROM businesses`.execute(db);
  for (const { id } of businesses) {
    await runAsBusiness(id, () => sql`DELETE FROM ledger_links WHERE business_id = ${id} AND key = 'refunds_owed'`.execute(db));
  }
  await sql`DROP INDEX IF EXISTS returns_transfer_owed_idx`.execute(db);
  await sql`
    ALTER TABLE returns
      DROP CONSTRAINT IF EXISTS returns_transfer_sent,
      DROP CONSTRAINT IF EXISTS returns_transfer_to,
      DROP CONSTRAINT IF EXISTS returns_refund_parts,
      DROP COLUMN IF EXISTS transfer_sent_at,
      DROP COLUMN IF EXISTS transfer_sent_by,
      DROP COLUMN IF EXISTS transfer_sent_from,
      DROP COLUMN IF EXISTS transfer_sent_on,
      DROP COLUMN IF EXISTS refund_batch,
      DROP COLUMN IF EXISTS refund_iban,
      DROP COLUMN IF EXISTS refund_to,
      DROP COLUMN IF EXISTS card_approval_code,
      DROP COLUMN IF EXISTS refund_tab,
      DROP COLUMN IF EXISTS refund_transfer,
      DROP COLUMN IF EXISTS refund_card
  `.execute(db);
}
