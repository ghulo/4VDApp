import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export type PartnerSide = 'customer' | 'supplier';

/** A customer or supplier as the look-up shows it: enough to fill a new firm's form. */
export interface PartnerMatch {
  side: PartnerSide;
  id: number;
  name: string;
  kind: 'person' | 'business';
  nui: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  businessNo: string | null;
  fiscalNo: string | null;
  vatNo: string | null;
  iban: string | null;
  contactPerson: string | null;
  mobile: string | null;
  archived: boolean;
}

export interface AddressRecord {
  id: number;
  customer_id: number | null;
  supplier_id: number | null;
  label: string;
  address: string;
  city: string | null;
  note: string | null;
}

export interface AddressFields {
  label: string;
  address: string;
  city: string | null;
  note: string | null;
}

/** NUIs are compared by their digits only ("81 123 4567" is 811234567). */
export const nuiDigits = (nui: string | null | undefined) => (nui ?? '').replace(/\D/g, '');

export class PartnerRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Customers and suppliers with this NUI, or whose name has these words; archived ones too, marked. */
  async lookup(input: { nui?: string; q?: string }, limit = 8): Promise<PartnerMatch[]> {
    const nui = nuiDigits(input.nui);
    const words = (input.q ?? '').trim();
    if (nui.length < 3 && words.length < 2) return [];
    const where = (alias: string) =>
      nui.length >= 3
        ? sql`regexp_replace(coalesce(${sql.ref(`${alias}.nui`)}, ''), '\\D', '', 'g') like ${`${nui}%`}`
        : sql`${sql.ref(`${alias}.name`)} ilike ${`%${words.replace(/[%_\\]/g, '\\$&')}%`}`;
    const { rows } = await sql<{
      side: PartnerSide;
      id: number;
      name: string;
      kind: 'person' | 'business';
      nui: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      city: string | null;
      business_no: string | null;
      fiscal_no: string | null;
      vat_no: string | null;
      iban: string | null;
      contact_person: string | null;
      mobile: string | null;
      archived: boolean;
    }>`
      select * from (
        select 'customer' as side, c.id, c.name, c.kind, c.nui, c.phone, null::text as email, c.address, c.city, c.business_no, c.fiscal_no, c.vat_no,
          c.iban, c.contact_person, c.mobile, c.archived_at is not null as archived
        from customers c where ${where('c')}
        union all
        select 'supplier', s.id, s.name, 'business', s.nui, s.phone, s.email, s.address, s.city, s.business_no, s.fiscal_no, s.vat_no,
          s.iban, s.contact_person, s.mobile, s.archived_at is not null
        from suppliers s where ${where('s')}
      ) m order by archived, name limit ${limit}
    `.execute(this.db);
    return rows.map((row) => ({
      side: row.side,
      id: row.id,
      name: row.name,
      kind: row.kind,
      nui: row.nui,
      phone: row.phone,
      email: row.email,
      address: row.address,
      city: row.city,
      businessNo: row.business_no,
      fiscalNo: row.fiscal_no,
      vatNo: row.vat_no,
      iban: row.iban,
      contactPerson: row.contact_person,
      mobile: row.mobile,
      archived: row.archived,
    }));
  }

  async customer(id: number) {
    return this.db.selectFrom('customers').select(['id', 'name', 'nui', 'bonus_percent', 'archived_at']).where('id', '=', id).executeTakeFirst();
  }

  async supplier(id: number) {
    return this.db.selectFrom('suppliers').select(['id', 'name', 'nui', 'archived_at']).where('id', '=', id).executeTakeFirst();
  }

  /** The other side of a firm: the supplier with a customer's NUI, or the customer with a supplier's. */
  async otherSide(side: PartnerSide, nui: string | null): Promise<{ id: number; name: string } | undefined> {
    const digits = nuiDigits(nui);
    if (digits.length < 8) return undefined;
    const table = side === 'customer' ? 'suppliers' : 'customers';
    return this.db
      .selectFrom(table)
      .select(['id', 'name'])
      .where(sql<boolean>`regexp_replace(coalesce(nui, ''), '\\D', '', 'g') = ${digits}`)
      .where('archived_at', 'is', null)
      .orderBy('id')
      .executeTakeFirst();
  }

  addresses(owner: { customerId?: number; supplierId?: number }): Promise<AddressRecord[]> {
    let query = this.db.selectFrom('partner_addresses').select(['id', 'customer_id', 'supplier_id', 'label', 'address', 'city', 'note']);
    query = owner.customerId !== undefined ? query.where('customer_id', '=', owner.customerId) : query.where('supplier_id', '=', owner.supplierId ?? 0);
    return query.orderBy('id').execute();
  }

  findAddress(id: number): Promise<AddressRecord | undefined> {
    return this.db.selectFrom('partner_addresses').select(['id', 'customer_id', 'supplier_id', 'label', 'address', 'city', 'note']).where('id', '=', id).executeTakeFirst();
  }

  async addAddress(owner: { customerId: number | null; supplierId: number | null }, fields: AddressFields): Promise<number> {
    const row = await this.db
      .insertInto('partner_addresses')
      .values({ customer_id: owner.customerId, supplier_id: owner.supplierId, ...fields })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateAddress(id: number, fields: AddressFields): Promise<void> {
    await this.db.updateTable('partner_addresses').set(fields).where('id', '=', id).execute();
  }

  async removeAddress(id: number): Promise<void> {
    await this.db.deleteFrom('partner_addresses').where('id', '=', id).execute();
  }

  async addOffset(offset: { customerId: number; supplierId: number; amount: number; day: string; note: string | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('partner_offsets')
      .values({ customer_id: offset.customerId, supplier_id: offset.supplierId, amount: offset.amount, day: offset.day, note: offset.note, created_by: offset.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  offsets(customerId: number) {
    return this.db
      .selectFrom('partner_offsets as o')
      .leftJoin('users as u', 'u.id', 'o.created_by')
      .select(['o.id', 'o.amount', sql<string>`to_char(o.day, 'YYYY-MM-DD')`.as('day'), 'o.note', 'u.name as by'])
      .where('o.customer_id', '=', customerId)
      .orderBy('o.day', 'desc')
      .orderBy('o.id', 'desc')
      .execute();
  }

  async setCreditFrom(entryId: number, from: { offsetId?: number; bonusId?: number }): Promise<void> {
    await this.db
      .updateTable('tab_entries')
      .set({ offset_id: from.offsetId ?? null, bonus_id: from.bonusId ?? null })
      .where('id', '=', entryId)
      .execute();
  }

  async setPaymentOffset(paymentId: number, offsetId: number): Promise<void> {
    await this.db.updateTable('supplier_payments').set({ offset_id: offsetId }).where('id', '=', paymentId).execute();
  }

  /** What a customer bought in each year (invoices made out to them, less credit notes). */
  async boughtByYear(customerId: number, timeZone: string): Promise<Map<number, number>> {
    const { rows } = await sql<{ year: number; bought: string }>`
      select extract(year from issued_at at time zone ${timeZone})::int as year, sum(case when kind = 'invoice' then total else -total end) as bought
      from documents where customer_id = ${customerId} group by 1
    `.execute(this.db);
    return new Map(rows.map((row) => [row.year, Number(row.bought)]));
  }

  bonusPayouts(customerId: number) {
    return this.db
      .selectFrom('bonus_payouts')
      .select(['id', 'year', 'bought', 'percent', 'amount', sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day')])
      .where('customer_id', '=', customerId)
      .orderBy('year', 'desc')
      .execute();
  }

  async addBonusPayout(payout: { customerId: number; year: number; bought: number; percent: number; amount: number; day: string; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('bonus_payouts')
      .values({
        customer_id: payout.customerId,
        year: payout.year,
        bought: payout.bought,
        percent: payout.percent,
        amount: payout.amount,
        day: payout.day,
        created_by: payout.createdBy,
      })
      .onConflict((conflict) => conflict.columns(['customer_id', 'year']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return row?.id ?? 0;
  }
}
