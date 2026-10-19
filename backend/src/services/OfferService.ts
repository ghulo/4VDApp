import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { NotFoundError } from '../errors/httpErrors.js';
import { roundMoney } from '../utils/money.js';
import { toOffset, toPaginationMeta } from '../utils/pagination.js';

/** An offer: a price quote printed for a customer before they buy. So far only TREFIN's, to look at. */
export interface OfferDto {
  id: number;
  number: string | null;
  /** "YYYY-MM-DD". */
  day: string;
  customer: { id: number; name: string } | null;
  /** The customer as TREFIN named it, when it isn't in 4VD's list. */
  partyName: string | null;
  total: number;
  lineCount: number;
  /** Which TREFIN database; the dashboard says it in words. */
  source: string;
}

export interface OfferDetailDto extends OfferDto {
  lines: Array<{ productId: number | null; productName: string; quantity: number; unitPrice: number; total: number }>;
}

interface OfferRow {
  id: number;
  number: string | null;
  day: string;
  customer_id: number | null;
  customer_name: string | null;
  party_name: string | null;
  total: string;
  line_count: number;
  source: string;
}

export class OfferService {
  constructor(private readonly db: DatabaseClient) {}

  /** A page of offers, newest first; the number, the customer or a product's name finds one. */
  async list(query: { search?: string; page: number; limit: number }) {
    const pattern = query.search ? `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = sql`(${pattern}::text is null or o.number ilike ${pattern} or o.party_name ilike ${pattern} or c.name ilike ${pattern}
      or exists (select 1 from trefin_offer_lines l where l.offer_id = o.id and l.product_name ilike ${pattern}))`;
    const [rows, count] = await Promise.all([
      sql<OfferRow>`${this.select()} where ${where} order by o.offered_on desc, o.id desc limit ${query.limit} offset ${toOffset(query)}`.execute(this.db),
      sql<{ total: string }>`select count(*) as total from trefin_offers o left join customers c on c.id = o.customer_id where ${where}`.execute(this.db),
    ]);
    return { items: rows.rows.map(toDto), meta: toPaginationMeta(query, Number(count.rows[0]?.total ?? 0)) };
  }

  async get(id: number): Promise<OfferDetailDto> {
    const { rows } = await sql<OfferRow>`${this.select()} where o.id = ${id}`.execute(this.db);
    if (!rows[0]) throw new NotFoundError(`Offer ${id} does not exist`);
    const { rows: lines } = await sql<{ product_id: number | null; product_name: string; quantity: string; unit_price: string; total: string }>`
      select product_id, product_name, quantity, unit_price, total from trefin_offer_lines where offer_id = ${id} order by id
    `.execute(this.db);
    return {
      ...toDto(rows[0]),
      lines: lines.map((line) => ({
        productId: line.product_id,
        productName: line.product_name,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unit_price),
        total: Number(line.total),
      })),
    };
  }

  private select() {
    return sql`
      select o.id, o.number, to_char(o.offered_on, 'YYYY-MM-DD') as day, o.customer_id, c.name as customer_name, o.party_name, o.total, o.source,
        (select count(*)::int from trefin_offer_lines l where l.offer_id = o.id) as line_count
      from trefin_offers o left join customers c on c.id = o.customer_id
    `;
  }
}

function toDto(row: OfferRow): OfferDto {
  return {
    id: row.id,
    number: row.number,
    day: row.day,
    customer: row.customer_id !== null && row.customer_name !== null ? { id: row.customer_id, name: row.customer_name } : null,
    partyName: row.party_name,
    total: roundMoney(Number(row.total)),
    lineCount: row.line_count,
    source: row.source,
  };
}
