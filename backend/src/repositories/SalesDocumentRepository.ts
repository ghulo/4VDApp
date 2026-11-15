import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { DeliveryStatus, OfferStatus } from '../database/types.js';

export interface OfferRecord {
  id: number;
  number: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  party_name: string | null;
  party_phone: string | null;
  note: string | null;
  valid_until: string;
  status: OfferStatus;
  total: string;
  sale_document_id: number | null;
  sale_number: string | null;
  decided_at: Date | null;
  created_by_name: string | null;
  created_at: Date;
  line_count: number;
}

export interface OfferLineRecord {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: string;
  shelf_price: string;
  total: string;
}

export interface DeliveryRecord {
  id: number;
  document_id: number;
  document_number: string;
  customer_id: number | null;
  name: string;
  phone: string | null;
  address: string;
  deliver_on: string;
  time_from: string | null;
  time_to: string | null;
  note: string | null;
  total: string;
  to_collect: string;
  status: DeliveryStatus;
  taken_by: number | null;
  taken_by_name: string | null;
  taken_at: Date | null;
  delivered_by_name: string | null;
  delivered_at: Date | null;
  collected: string | null;
  last_failure: string | null;
  failures: number;
  created_at: Date;
  line_count: number;
}

export interface NewDelivery {
  documentId: number;
  customerId: number | null;
  name: string;
  phone: string | null;
  address: string;
  deliverOn: string;
  timeFrom: string | null;
  timeTo: string | null;
  note: string | null;
  total: number;
  toCollect: number;
  createdBy: number;
}

/** Offers made in 4VD and sales taken to the customer: step 8's documents. */
export class SalesDocumentRepository {
  constructor(private readonly db: DatabaseClient) {}

  // ---- Offers ----

  async createOffer(input: {
    number: string;
    customerId: number | null;
    partyName: string | null;
    partyPhone: string | null;
    note: string | null;
    validUntil: string;
    total: number;
    createdBy: number;
    lines: Array<{ productId: number; productName: string; quantity: number; unitPrice: number; shelfPrice: number; total: number }>;
  }): Promise<number> {
    const row = await this.db
      .insertInto('offers')
      .values({
        number: input.number,
        customer_id: input.customerId,
        party_name: input.partyName,
        party_phone: input.partyPhone,
        note: input.note,
        valid_until: input.validUntil,
        total: input.total,
        created_by: input.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db
      .insertInto('offer_lines')
      .values(
        input.lines.map((line) => ({
          offer_id: row.id,
          product_id: line.productId,
          product_name: line.productName,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          shelf_price: line.shelfPrice,
          total: line.total,
        })),
      )
      .execute();
    return row.id;
  }

  private offerSelect() {
    return sql`
      select o.id, o.number, o.customer_id, c.name as customer_name, c.phone as customer_phone, o.party_name, o.party_phone, o.note,
        to_char(o.valid_until, 'YYYY-MM-DD') as valid_until, o.status, o.total, o.sale_document_id, d.number as sale_number,
        o.decided_at, u.name as created_by_name, o.created_at,
        (select count(*)::int from offer_lines l where l.offer_id = o.id) as line_count
      from offers o
      left join customers c on c.id = o.customer_id
      left join documents d on d.id = o.sale_document_id
      left join users u on u.id = o.created_by
    `;
  }

  async findOffers(query: { search?: string; status?: OfferStatus; limit: number; offset: number }): Promise<{ rows: OfferRecord[]; total: number }> {
    const pattern = query.search ? `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = sql`(${pattern}::text is null or o.number ilike ${pattern} or o.party_name ilike ${pattern} or c.name ilike ${pattern}
        or exists (select 1 from offer_lines l where l.offer_id = o.id and l.product_name ilike ${pattern}))
      and (${query.status ?? null}::text is null or o.status = ${query.status ?? null})`;
    const [rows, count] = await Promise.all([
      sql<OfferRecord>`${this.offerSelect()} where ${where} order by o.created_at desc, o.id desc limit ${query.limit} offset ${query.offset}`.execute(this.db),
      sql<{ total: string }>`select count(*) as total from offers o left join customers c on c.id = o.customer_id where ${where}`.execute(this.db),
    ]);
    return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async findOffer(id: number): Promise<OfferRecord | undefined> {
    const { rows } = await sql<OfferRecord>`${this.offerSelect()} where o.id = ${id}`.execute(this.db);
    return rows[0];
  }

  async offerLines(offerId: number): Promise<OfferLineRecord[]> {
    return this.db
      .selectFrom('offer_lines')
      .select(['id', 'product_id', 'product_name', 'quantity', 'unit_price', 'shelf_price', 'total'])
      .where('offer_id', '=', offerId)
      .orderBy('id')
      .execute();
  }

  /** Only an open offer changes; returns false when it was decided already. */
  async decideOffer(id: number, status: Exclude<OfferStatus, 'open'>, saleDocumentId: number | null): Promise<boolean> {
    const result = await this.db
      .updateTable('offers')
      .set({ status, sale_document_id: saleDocumentId, decided_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'open')
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  // ---- Deliveries ----

  async createDelivery(input: NewDelivery): Promise<number> {
    const row = await this.db
      .insertInto('customer_deliveries')
      .values({
        document_id: input.documentId,
        customer_id: input.customerId,
        name: input.name,
        phone: input.phone,
        address: input.address,
        deliver_on: input.deliverOn,
        time_from: input.timeFrom,
        time_to: input.timeTo,
        note: input.note,
        total: input.total,
        to_collect: input.toCollect,
        created_by: input.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  private deliverySelect() {
    return sql`
      select x.id, x.document_id, d.number as document_number, x.customer_id, x.name, x.phone, x.address,
        to_char(x.deliver_on, 'YYYY-MM-DD') as deliver_on, to_char(x.time_from, 'HH24:MI') as time_from, to_char(x.time_to, 'HH24:MI') as time_to,
        x.note, x.total, x.to_collect, x.status, x.taken_by, t.name as taken_by_name, x.taken_at, v.name as delivered_by_name, x.delivered_at,
        x.collected, x.last_failure, x.failures, x.created_at,
        (select count(*)::int from document_lines l where l.document_id = x.document_id) as line_count
      from customer_deliveries x
      join documents d on d.id = x.document_id
      left join users t on t.id = x.taken_by
      left join users v on v.id = x.delivered_by
    `;
  }

  /** Everything still to deliver, then what was delivered since `since`. */
  async findDeliveries(since: Date): Promise<DeliveryRecord[]> {
    const { rows } = await sql<DeliveryRecord>`
      ${this.deliverySelect()}
      where x.status <> 'delivered' or x.delivered_at >= ${since}
      order by x.status = 'delivered', x.deliver_on, x.time_from nulls last, x.id
    `.execute(this.db);
    return rows;
  }

  async findDelivery(id: number, forUpdate = false): Promise<DeliveryRecord | undefined> {
    const { rows } = await sql<DeliveryRecord>`${this.deliverySelect()} where x.id = ${id} ${forUpdate ? sql`for update of x` : sql``}`.execute(this.db);
    return rows[0];
  }

  async countOpenDeliveries(): Promise<number> {
    const row = await this.db.selectFrom('customer_deliveries').select(sql<string>`count(*)`.as('n')).where('status', '<>', 'delivered').executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async updateDelivery(
    id: number,
    patch: Partial<{
      status: DeliveryStatus;
      taken_by: number | null;
      taken_at: Date | null;
      delivered_by: number | null;
      delivered_at: Date | null;
      collected: number | null;
      payment_entry_id: number | null;
      last_failure: string | null;
      failures: number;
      deliver_on: string;
      time_from: string | null;
      time_to: string | null;
    }>,
  ): Promise<void> {
    await this.db.updateTable('customer_deliveries').set(patch).where('id', '=', id).execute();
  }

  /** What is on each delivery's invoice, so whoever takes it knows what to load. */
  async documentLines(documentIds: number[]): Promise<Array<{ document_id: number; product_name: string; quantity: number }>> {
    if (documentIds.length === 0) return [];
    return this.db
      .selectFrom('document_lines')
      .select(['document_id', 'product_name', 'quantity'])
      .where('document_id', 'in', documentIds)
      .orderBy('id')
      .execute();
  }

  /** Where this customer had things taken last time, to fill in the next delivery. */
  async lastAddressOf(customerId: number): Promise<{ address: string; phone: string | null } | undefined> {
    return this.db
      .selectFrom('customer_deliveries')
      .select(['address', 'phone'])
      .where('customer_id', '=', customerId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }
}
