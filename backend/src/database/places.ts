import { type Kysely, sql } from 'kysely';

export type PlaceKind = 'till' | 'safe' | 'bank';

/** The account every till and the safe sits under, and the one every bank account sits under (TREFIN's chart). */
const PARENT_NUMBER: Record<PlaceKind, string> = { till: '1110', safe: '1110', bank: '1120' };
const GROUP = 'Paratë në arkë dhe bankë';
const TYPE = 'Pasuria Qarkulluese';

/**
 * ` and <alias>.business_id = <id>` when a business is named, else nothing.
 * A new business is seeded with its id named in every query (seedBusiness), so
 * a script or an owner connection, which row security doesn't limit, can never
 * pick up another business's places or accounts. Requests in the app, and
 * migration 042 (from before businesses existed), name none and rely on row
 * security.
 */
const only = (alias: string, businessId: number | undefined) =>
  businessId === undefined ? sql`` : sql` and ${sql.ref(`${alias}.business_id`)} = ${businessId}`;

/** The account's name in the books, in the accountant's language: "Arka – Lavazhi Qendër", "Banka – Raiffeisen". */
export function placeAccountName(kind: PlaceKind, name: string | null): string {
  if (kind === 'bank') return `Banka – ${name ?? 'llogaria'}`.slice(0, 200);
  if (kind === 'safe') return name ? `Kasaforta – ${name}`.slice(0, 200) : 'Kasaforta';
  return `Arka – ${name ?? 'dyqani'}`.slice(0, 200);
}

/**
 * The ledger account for a new place: an unused account with the same name if
 * there is one (after a reset), else the next free number under 1110 or 1120
 * (1111…1119, then 111010…111099), so TREFIN's chart stays as it is.
 */
export async function accountForPlace(db: Kysely<unknown>, kind: PlaceKind, name: string | null, businessId?: number): Promise<number> {
  const accountName = placeAccountName(kind, name);
  const unused = await sql<{ id: number }>`
    select a.id from ledger_accounts a
    where a.name = ${accountName} and a.archived_at is null
      and not exists (select 1 from money_places p where p.account_id = a.id)${only('a', businessId)}
    order by a.number limit 1
  `.execute(db);
  if (unused.rows[0]) return unused.rows[0].id;

  const parent = PARENT_NUMBER[kind];
  const taken = new Set(
    (await sql<{ number: string }>`select a.number from ledger_accounts a where a.number like ${`${parent.slice(0, 3)}%`}${only('a', businessId)}`.execute(db)).rows.map(
      (row) => row.number,
    ),
  );
  const candidates = [
    ...Array.from({ length: 9 }, (_, index) => String(Number(parent) + index + 1)),
    ...Array.from({ length: 90 }, (_, index) => `${parent}${index + 10}`),
  ];
  const number = candidates.find((candidate) => !taken.has(candidate));
  if (!number) throw new Error(`No free account number left under ${parent}`);
  const created =
    businessId === undefined
      ? await sql<{ id: number }>`
          insert into ledger_accounts (number, name, class, type_name, group_name, cash_flow)
          values (${number}, ${accountName}, 'asset', ${TYPE}, ${GROUP}, 'operating')
          returning id
        `.execute(db)
      : await sql<{ id: number }>`
          insert into ledger_accounts (business_id, number, name, class, type_name, group_name, cash_flow)
          values (${businessId}, ${number}, ${accountName}, 'asset', ${TYPE}, ${GROUP}, 'operating')
          returning id
        `.execute(db);
  return created.rows[0]!.id;
}

/** The account that stands for a kind of place before any sub-account: 1110 for the shop till, 1120 for the first bank. */
async function parentAccount(db: Kysely<unknown>, kind: 'till' | 'bank', businessId?: number): Promise<number | null> {
  const row = await sql<{ id: number }>`
    select a.id from ledger_accounts a
    where a.number = ${PARENT_NUMBER[kind]} and not exists (select 1 from money_places p where p.account_id = a.id)${only('a', businessId)}
  `.execute(db);
  return row.rows[0]?.id ?? null;
}

/**
 * Make sure the places every shop has exist, each with its account: the shop's
 * till (on 1110 itself), a till for each carwash, a safe and a bank account
 * (on 1120 itself). Cheap when they all exist; safe to call before anything
 * that needs a place. `businessId` names the business in every query (a new
 * business's seed); without it row security picks the business.
 */
export async function ensurePlaces(db: Kysely<unknown>, businessId?: number): Promise<void> {
  const { rows } = await sql<{ missing: boolean }>`
    select (
      not exists (select 1 from money_places p where p.kind = 'till' and p.carwash_id is null${only('p', businessId)})
      or not exists (select 1 from money_places p where p.kind = 'safe' and p.is_default${only('p', businessId)})
      or not exists (select 1 from money_places p where p.kind = 'bank' and p.is_default${only('p', businessId)})
      or exists (select 1 from carwashes c where c.archived_at is null${only('c', businessId)} and not exists (select 1 from money_places p where p.carwash_id = c.id))
      or exists (select 1 from money_places p where p.account_id is null${only('p', businessId)})
    ) as missing
  `.execute(db);
  if (!rows[0]?.missing) return;

  // One request at a time; the next one finds them made. The lock lasts until
  // the transaction ends, so outside one it needs its own.
  const make = businessId === undefined ? makePlaces : (trx: Kysely<unknown>) => makePlacesFor(trx, businessId);
  if (db.isTransaction) await make(db);
  else await db.transaction().execute((trx) => make(trx));
}

async function makePlaces(db: Kysely<unknown>): Promise<void> {
  await sql`select pg_advisory_xact_lock(40840)`.execute(db);
  await sql`
    insert into money_places (kind) select 'till'
    where not exists (select 1 from money_places where kind = 'till' and carwash_id is null)
  `.execute(db);
  await sql`
    insert into money_places (kind, is_default) select 'safe', true
    where not exists (select 1 from money_places where kind = 'safe' and is_default)
  `.execute(db);
  await sql`
    insert into money_places (kind, is_default, name, bank_name, iban)
    select 'bank', true, b.bank_name, b.bank_name, b.iban from (select 1) one
    left join lateral (select bank_name, iban from businesses where id = nullif(current_setting('app.business_id', true), '')::int) b on true
    where not exists (select 1 from money_places where kind = 'bank' and is_default)
  `.execute(db);
  await sql`
    insert into money_places (kind, carwash_id)
    select 'till', c.id from carwashes c
    where c.archived_at is null and not exists (select 1 from money_places p where p.carwash_id = c.id)
  `.execute(db);

  const needing = await sql<{ id: number; kind: PlaceKind; name: string | null; carwash_id: number | null; carwash_name: string | null; is_default: boolean }>`
    select p.id, p.kind, p.name, p.carwash_id, c.name as carwash_name, p.is_default
    from money_places p left join carwashes c on c.id = p.carwash_id
    where p.account_id is null order by p.id
  `.execute(db);
  for (const place of needing.rows) {
    const isShopTill = place.kind === 'till' && place.carwash_id === null;
    const parent = isShopTill ? await parentAccount(db, 'till') : place.kind === 'bank' && place.is_default ? await parentAccount(db, 'bank') : null;
    const accountId = parent ?? (await accountForPlace(db, place.kind, place.carwash_name ?? place.name));
    await sql`update money_places set account_id = ${accountId} where id = ${place.id}`.execute(db);
  }
}

/** makePlaces for a business named by id: every row read and written for it alone. */
async function makePlacesFor(db: Kysely<unknown>, businessId: number): Promise<void> {
  await sql`select pg_advisory_xact_lock(40840)`.execute(db);
  await sql`
    insert into money_places (business_id, kind) select ${businessId}, 'till'
    where not exists (select 1 from money_places where business_id = ${businessId} and kind = 'till' and carwash_id is null)
  `.execute(db);
  await sql`
    insert into money_places (business_id, kind, is_default) select ${businessId}, 'safe', true
    where not exists (select 1 from money_places where business_id = ${businessId} and kind = 'safe' and is_default)
  `.execute(db);
  await sql`
    insert into money_places (business_id, kind, is_default, name, bank_name, iban)
    select ${businessId}, 'bank', true, b.bank_name, b.bank_name, b.iban from businesses b
    where b.id = ${businessId}
      and not exists (select 1 from money_places where business_id = ${businessId} and kind = 'bank' and is_default)
  `.execute(db);
  await sql`
    insert into money_places (business_id, kind, carwash_id)
    select ${businessId}, 'till', c.id from carwashes c
    where c.business_id = ${businessId} and c.archived_at is null and not exists (select 1 from money_places p where p.carwash_id = c.id)
  `.execute(db);

  const needing = await sql<{ id: number; kind: PlaceKind; name: string | null; carwash_id: number | null; carwash_name: string | null; is_default: boolean }>`
    select p.id, p.kind, p.name, p.carwash_id, c.name as carwash_name, p.is_default
    from money_places p left join carwashes c on c.id = p.carwash_id
    where p.business_id = ${businessId} and p.account_id is null order by p.id
  `.execute(db);
  for (const place of needing.rows) {
    const isShopTill = place.kind === 'till' && place.carwash_id === null;
    const parent = isShopTill
      ? await parentAccount(db, 'till', businessId)
      : place.kind === 'bank' && place.is_default
        ? await parentAccount(db, 'bank', businessId)
        : null;
    const accountId = parent ?? (await accountForPlace(db, place.kind, place.carwash_name ?? place.name, businessId));
    await sql`update money_places set account_id = ${accountId} where id = ${place.id} and business_id = ${businessId}`.execute(db);
  }
}
