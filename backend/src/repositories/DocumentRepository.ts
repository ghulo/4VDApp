import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { DocumentKind, DocumentParty, DocumentPaymentMethod } from '../database/types.js';
import { escapeLikePattern } from '../utils/databaseErrors.js';

/** Printed around a document from the shop's current settings; the document itself never changes. */
export interface Letterhead {
  logo: { mime: string; bytes: Buffer } | null;
  bankName: string | null;
  iban: string | null;
  /** The shop's own words at the bottom of every invoice. */
  note: string | null;
}

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
  payment_method: DocumentPaymentMethod;
  /** "YYYY-MM-DD", for invoices paid on account. */
  due_date: string | null;
}

export interface DocumentLineRecord {
  id: number;
  sale_id: number;
  return_id: number | null;
  product_name: string;
  product_code: string | null;
  quantity: number;
  unit_price: string;
  discount_percent: string | null;
  price_before_discount: string | null;
  vat_rate: number;
  vat_exempt: boolean;
  net_amount: string;
  vat_amount: string;
  total: string;
}

export interface NewDocumentLine {
  saleId: number;
  returnId: number | null;
  productName: string;
  productCode: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number | null;
  priceBeforeDiscount: number | null;
  vatRate: number;
  vatExempt?: boolean;
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
  paymentMethod: DocumentPaymentMethod;
  dueDate: string | null;
  lines: NewDocumentLine[];
}

/** What the matching documents add up to; credit notes count against invoices. */
export type DocumentSums = {
  netTotal: number;
  vatTotal: number;
  total: number;
};

export interface DocumentFilters {
  kind?: DocumentKind;
  /** Part of a number or the buyer's name. */
  search?: string;
  customerId?: number;
  startDate?: Date;
  endDate?: Date;
  limit: number;
  offset: number;
}

/** A sale as an invoice line needs it. */
export interface SaleForDocument {
  id: number;
  product_name: string;
  product_code: string | null;
  quantity_sold: number;
  price_per_unit: string;
  discount_percent: string | null;
  price_before_discount: string | null;
  vat_rate: number;
  vat_exempt: boolean;
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

  /** What the page prints around a document today: the shop's logo and bank account. */
  async letterhead(): Promise<Letterhead> {
    const row = await this.db
      .selectFrom('businesses as b')
      .leftJoin('media as m', 'm.id', 'b.logo_media_id')
      .select(['b.bank_name', 'b.iban', 'b.invoice_note', 'm.mime', 'm.bytes'])
      .orderBy('b.id')
      .executeTakeFirstOrThrow();
    return {
      logo: row.mime && row.bytes ? { mime: row.mime, bytes: row.bytes } : null,
      bankName: row.bank_name,
      iban: row.iban,
      note: row.invoice_note,
    };
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
        payment_method: document.paymentMethod,
        due_date: document.dueDate,
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
          product_code: line.productCode,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          discount_percent: line.discountPercent,
          price_before_discount: line.priceBeforeDiscount,
          vat_rate: line.vatRate,
          vat_exempt: line.vatExempt ?? false,
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
        'd.payment_method',
        sql<string | null>`to_char(d.due_date, 'YYYY-MM-DD')`.as('due_date'),
      ]);
  }

  async findMany(filters: DocumentFilters): Promise<{ documents: DocumentRecord[]; total: number; sums: DocumentSums }> {
    let query = this.baseQuery();
    if (filters.kind) query = query.where('d.kind', '=', filters.kind);
    if (filters.customerId) query = query.where('d.customer_id', '=', filters.customerId);
    if (filters.startDate) query = query.where('d.issued_at', '>=', filters.startDate);
    if (filters.endDate) query = query.where('d.issued_at', '<', filters.endDate);
    if (filters.search) {
      const pattern = `%${escapeLikePattern(filters.search)}%`;
      query = query.where((eb) => eb.or([eb('d.number', 'ilike', pattern), eb(sql`d.buyer->>'name'`, 'ilike', pattern)]));
    }
    // A credit note takes its amount back off the invoices.
    const signed = (column: 'd.net_total' | 'd.vat_total' | 'd.total') =>
      sql<string>`coalesce(sum(case when d.kind = 'credit_note' then -${sql.ref(column)} else ${sql.ref(column)} end), 0)`;
    const [documents, count] = await Promise.all([
      query.orderBy('d.issued_at', 'desc').orderBy('d.id', 'desc').limit(filters.limit).offset(filters.offset).execute(),
      query
        .clearSelect()
        .select((eb) => [eb.fn.countAll<string>().as('total'), signed('d.net_total').as('net'), signed('d.vat_total').as('vat'), signed('d.total').as('sum')])
        .executeTakeFirstOrThrow(),
    ]);
    return {
      documents,
      total: Number(count.total),
      sums: { netTotal: Number(count.net), vatTotal: Number(count.vat), total: Number(count.sum) },
    };
  }

  findById(id: number): Promise<DocumentRecord | undefined> {
    return this.baseQuery().where('d.id', '=', id).executeTakeFirst();
  }

  findLines(documentId: number): Promise<DocumentLineRecord[]> {
    return this.db
      .selectFrom('document_lines')
      .select(['id', 'sale_id', 'return_id', 'product_name', 'product_code', 'quantity', 'unit_price', 'discount_percent', 'price_before_discount', 'vat_rate', 'vat_exempt', 'net_amount', 'vat_amount', 'total'])
      .where('document_id', '=', documentId)
      .orderBy('id')
      .execute();
  }

  /** What a document's history takes in: its sales, their returns, and the credit notes tied to it. */
  async related(documentId: number): Promise<{ saleIds: number[]; returnIds: number[]; documentIds: number[] }> {
    const lines = await this.findLines(documentId);
    const saleIds = [...new Set(lines.flatMap((line) => (line.sale_id === null ? [] : [line.sale_id])))];
    const returns = saleIds.length > 0 ? await this.db.selectFrom('returns').select('id').where('sale_id', 'in', saleIds).execute() : [];
    const documents = await this.db
      .selectFrom('documents')
      .select('id')
      .where((eb) => eb.or([eb('corrects_id', '=', documentId), eb('id', '=', eb.selectFrom('documents').select('corrects_id').where('id', '=', documentId))]))
      .execute();
    const returnIds = new Set([...returns.map((row) => row.id), ...lines.flatMap((line) => (line.return_id === null ? [] : [line.return_id]))]);
    return { saleIds, returnIds: [...returnIds], documentIds: [documentId, ...documents.map((row) => row.id)] };
  }

  salesForDocument(saleIds: number[]): Promise<SaleForDocument[]> {
    return this.db
      .selectFrom('sales as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select((eb) => ['s.id', 'p.name as product_name', eb.fn.coalesce('p.barcode', 'p.sku').as('product_code'), 's.quantity_sold', 's.price_per_unit', 's.discount_percent', 's.price_before_discount', 'p.vat_rate', 'p.vat_exempt'])
      .where('s.id', 'in', saleIds)
      .orderBy('s.id')
      .execute();
  }

  /** The newest invoice line for a sale, with its document: what a credit note for it reverses. */
  lastInvoiceLineOf(saleId: number) {
    return this.db
      .selectFrom('document_lines as l')
      .innerJoin('documents as d', 'd.id', 'l.document_id')
      .select(['d.id as document_id', 'd.customer_id', 'd.buyer', 'd.payment_method', 'l.product_name', 'l.product_code', 'l.discount_percent', 'l.price_before_discount', 'l.vat_rate', 'l.vat_exempt'])
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
