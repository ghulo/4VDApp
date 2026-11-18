import { type Kysely, sql } from 'kysely';

/**
 * Many businesses, phase 5d-2: blocking someone in their home business blocks
 * only their place there (memberships.is_active), not the whole account
 * (users.is_active, which only deleting the account turns off).
 *
 * The users → home membership copy (migration 078) now copies only what
 * changed: a new role at home no longer copies users.is_active over a block
 * that lives on the membership.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION copy_user_to_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.business_id IS NULL THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'INSERT' OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        INSERT INTO memberships (user_id, business_id, role, is_active)
        VALUES (NEW.id, NEW.business_id, NEW.role, NEW.is_active)
        ON CONFLICT (user_id, business_id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;
      ELSE
        UPDATE memberships SET
          role = CASE WHEN NEW.role IS DISTINCT FROM OLD.role THEN NEW.role ELSE role END,
          is_active = CASE WHEN NEW.is_active IS DISTINCT FROM OLD.is_active THEN NEW.is_active ELSE is_active END
        WHERE user_id = NEW.id AND business_id = NEW.business_id;
      END IF;
      RETURN NEW;
    END $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION copy_user_to_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.business_id IS NOT NULL THEN
        INSERT INTO memberships (user_id, business_id, role, is_active)
        VALUES (NEW.id, NEW.business_id, NEW.role, NEW.is_active)
        ON CONFLICT (user_id, business_id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;
      END IF;
      RETURN NEW;
    END $$
  `.execute(db);
}
