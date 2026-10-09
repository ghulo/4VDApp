import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { DocumentKind, DocumentParty } from '../database/types.js';
import { escapeLikePattern } from '../utils/databaseErrors.js';

export interface DocumentRecord {
  id: number;
  kind: DocumentKind;
  number: string;
  issued_at: Date;
  issued_by: number | null;
  issued_by_name: string | null;
  seller: DocumentParty;
  customer_id: number | null;
  buyer: DocumentParty | null;
  corrects_id: number | null;
  corrects_number: string | null;
  reason: string | null;
  net_total: string;
  vat_total: string;
  total: string;
  fiscal_receipt_no: string | null;
}

export interface DocumentLineRecord {
  id: number;
  sale_id: number;
  return_id: number | null;
  product_name: string;
  quantity: number;
  unit_price: string;
  vat_rate: number;
  net_amount: string;
  vat_amount: string;
  total: string;
}

export interface NewDocumentLine {
  saleId: number;
  returnId: number | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  netAmount: number;
  vatAmount: number;
  total: number;
}

export interface NewDocument {
  kind: DocumentKind;
  number: string;
  issuedBy: number;
  seller: DocumentParty;
  customerId: number | null;
  buyer: DocumentParty | null;
  correctsId: number | null;
  reason: string | null;
  netTotal: number;
  vatTotal: number;
  total: number;
  lines: NewDocumentLine[];
}

export interface DocumentFilters {
  kind?: DocumentKind;
  /** Part of a number or the buyer's name. */
  search?: string;
  startDate?: Date;
  endDate?: Date;
  limit: number;
  offset: number;
}

/** A sale as an invoice line needs it. */
export interface SaleForDocument {
  id: number;
  product_name: string;
  quantity_sold: number;
  price_per_unit: string;
  vat_rate: number;
}

export class DocumentRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * The next number for this kind and year. The counter row stays locked until
   * the transaction ends, so two checkouts can't get the same number, and a
   * rolled-back one gives its number back (no gaps).
   */
  async nextNumber(kind: DocumentKind, year: number): Promise<number> {
    const row = await this.db
      .insertInto('document_numbers')
      .values({ kind, year, last_number: 1 })
      .onConflict((oc) => oc.columns(['kind', 'year']).doUpdateSet({ last_number: sql`document_numbers.last_number + 1` }))
      .returning('last_number')
      .executeTakeFirstOrThrow();
    return row.last_number;
  }

  async seller(): Promise<DocumentParty> {
    const business = await this.db
      .selectFrom('businesses')
      .select(['name', 'nui', 'address', 'phone'])
      .orderBy('id')
      .executeTakeFirstOrThrow();
    return business;
  }

  async create(document: NewDocument): Promise<number> {
    const { id } = await this.db
      .insertInto('documents')
      .values({
        kind: document.kind,
        number: document.number,
        issued_by: document.issuedBy,
        seller: JSON.stringify(document.seller),
        customer_id: document.customerId,
        buyer: document.buyer && JSON.stringify(document.buyer),
        corrects_id: document.correctsId,
        reason: document.reason,
        net_total: document.netTotal,
        vat_total: document.vatTotal,
        total: document.total,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db
      .insertInto('document_lines')
      .values(
        document.lines.map((line) => ({
          document_id: id,
          sale_id: line.saleId,
          return_id: line.returnId,
          product_name: line.productName,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          vat_rate: line.vatRate,
          net_amount: line.netAmount,
          vat_amount: line.vatAmount,
          total: line.total,
        })),
      )
      .execute();
    return id;
  }

  private baseQuery() {
    return this.db
      .selectFrom('documents as d')
      .leftJoin('users as u', 'u.id', 'd.issued_by')
      .leftJoin('documents as c', 'c.id', 'd.corrects_id')
      .select([
        'd.id',
        'd.kind',
        'd.number',
        'd.issued_at',
        'd.issued_by',
        'u.name as issued_by_name',
        'd.seller',
        'd.customer_id',
        'd.buyer',
        'd.corrects_id',
        'c.number as corrects_number',
        'd.reason',
        'd.net_total',
        'd.vat_total',
        'd.total',
        'd.fiscal_receipt_no',
      ]);
  }

  async findMany(filters: DocumentFilters): Promise<{ documents: DocumentRecord[]; total: number }> {
    let query = this.baseQuery();
    if (filters.kind) query = query.where('d.kind', '=', filters.kind);
    if (filters.startDate) query = query.where('d.issued_at', '>=', filters.startDate);
    if (filters.endDate) query = query.where('d.issued_at', '<', filters.endDate);
    if (filters.search) {
      const pattern = `%${escapeLikePattern(filters.search)}%`;
      query = query.where((eb) => eb.or([eb('d.number', 'ilike', pattern), eb(sql`d.buyer->>'name'`, 'ilike', pattern)]));
    }
    const [documents, count] = await Promise.all([
      query.orderBy('d.issued_at', 'desc').orderBy('d.id', 'desc').limit(filters.limit).offset(filters.offset).execute(),
      query.clearSelect().select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { documents, total: Number(count.total) };
  }

  findById(id: number): Promise<DocumentRecord | undefined> {
    return this.baseQuery().where('d.id', '=', id).executeTakeFirst();
  }

  findLines(documentId: number): Promise<DocumentLineRecord[]> {
    return this.db
      .selectFrom('document_lines')
      .select(['id', 'sale_id', 'return_id', 'product_name', 'quantity', 'unit_price', 'vat_rate', 'net_amount', 'vat_amount', 'total'])
      .where('document_id', '=', documentId)
      .orderBy('id')
      .execute();
  }

  salesForDocument(saleIds: number[]): Promise<SaleForDocument[]> {
    return this.db
      .selectFrom('sales as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select(['s.id', 'p.name as product_name', 's.quantity_sold', 's.price_per_unit', 'p.vat_rate'])
      .where('s.id', 'in', saleIds)
      .orderBy('s.id')
      .execute();
  }

  /** The newest invoice line for a sale, with its document: what a credit note for it reverses. */
  lastInvoiceLineOf(saleId: number) {
    return this.db
      .selectFrom('document_lines as l')
      .innerJoin('documents as d', 'd.id', 'l.document_id')
      .select(['d.id as document_id', 'd.customer_id', 'd.buyer', 'l.product_name', 'l.vat_rate'])
      .where('l.sale_id', '=', saleId)
      .where('d.kind', '=', 'invoice')
      .orderBy('d.id', 'desc')
      .executeTakeFirst();
  }

  async customerParty(customerId: number): Promise<DocumentParty | undefined> {
    const row = await this.db.selectFrom('customers').select(['name', 'nui', 'phone']).where('id', '=', customerId).executeTakeFirst();
    return row && { name: row.name, nui: row.nui, address: null, phone: row.phone };
  }

  async setFiscalReceipt(id: number, value: string | null): Promise<boolean> {
    const result = await this.db.updateTable('documents').set({ fiscal_receipt_no: value }).where('id', '=', id).executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
