import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { escapeLikePattern } from '../utils/databaseErrors.js';
import { zonedDay } from '../utils/zonedDates.js';
import { readRules } from './shopRules.js';

export interface SerialProductDto {
  productId: number;
  name: string;
  warrantyMonths: number | null;
}

/** A serial and everything known about it: where it came from, where it went, its warranty. */
export interface SerialDto {
  id: number;
  serial: string;
  productId: number;
  productName: string;
  status: 'in_stock' | 'sold';
  cameOn: string | null;
  bill: { id: number; number: string | null; supplier: string | null } | null;
  stockDocument: { id: number; number: string } | null;
  orderId: number | null;
  saleId: number | null;
  soldAt: string | null;
  invoice: { id: number; number: string } | null;
  customer: { id: number; name: string } | null;
  warrantyEnds: string | null;
  /** Under warranty today. */
  underWarranty: boolean;
  returnedAt: string | null;
}

export interface AddSerialsResult {
  added: number;
  /** Already recorded as in stock: left as they were. */
  alreadyInStock: string[];
}

const clean = (serial: string) => serial.trim().replace(/\s+/g, ' ');

/**
 * Serial numbers and warranty, on the products marked for them. Recording a
 * serial when it comes in is optional; at the sale it is required, typed or
 * picked. One serial per product: one sold and not returned can't be sold again.
 */
export class SerialService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  /** The products with serial numbers, for the Counter and the pickers. */
  async products(): Promise<SerialProductDto[]> {
    const rows = await this.db.selectFrom('products').select(['id', 'name', 'warranty_months']).where('has_serials', '=', true).where('deleted_at', 'is', null).orderBy('name').execute();
    return rows.map((row) => ({ productId: row.id, name: row.name, warrantyMonths: row.warranty_months }));
  }

  /** Marks a product as having serial numbers (or not), with its warranty in months. */
  async setProduct(productId: number, input: { hasSerials: boolean; warrantyMonths: number | null }, actorId: number): Promise<SerialProductDto | null> {
    await this.transactions.run(async (repos) => {
      await assertOn(repos);
      const product = await repos.products.findById(productId, true);
      if (!product) throw new NotFoundError(`Product ${productId} does not exist`);
      await repos.db.updateTable('products').set({ has_serials: input.hasSerials, warranty_months: input.warrantyMonths, updated_at: new Date() }).where('id', '=', productId).execute();
      await repos.activityLog.create({
        userId: actorId,
        action: 'product.updated',
        entityType: 'product',
        entityId: productId,
        say: { key: 'serialProductChanged', params: { product: product.name, on: input.hasSerials, months: input.warrantyMonths } },
        details: { hasSerials: input.hasSerials, warrantyMonths: input.warrantyMonths },
      });
    });
    return (await this.products()).find((product) => product.productId === productId) ?? null;
  }

  /** A product's serials: in stock first, then sold, newest first. */
  async forProduct(productId: number): Promise<SerialDto[]> {
    const rows = await this.query().where('s.product_id', '=', productId).orderBy(sql`s.status = 'sold'`).orderBy('s.id', 'desc').limit(500).execute();
    return rows.map((row) => this.toDto(row));
  }

  /** Every serial matching the text, of any product. */
  async search(text: string): Promise<SerialDto[]> {
    const rows = await this.query()
      .where(sql<boolean>`lower(s.serial) like ${`%${escapeLikePattern(text.trim().toLowerCase())}%`}`)
      .orderBy(sql`lower(s.serial) = ${text.trim().toLowerCase()}`, 'desc')
      .orderBy('s.id', 'desc')
      .limit(50)
      .execute();
    return rows.map((row) => this.toDto(row));
  }

  /** The serials on one sale, for the invoice. */
  async forSales(saleIds: number[]): Promise<Map<number, Array<{ serial: string; warrantyEnds: string | null }>>> {
    const result = new Map<number, Array<{ serial: string; warrantyEnds: string | null }>>();
    if (saleIds.length === 0) return result;
    const rows = await this.db
      .selectFrom('serials')
      .select(['sale_id', 'serial', sql<string | null>`to_char(warranty_ends, 'YYYY-MM-DD')`.as('warranty_ends')])
      .where('sale_id', 'in', saleIds)
      .orderBy('id')
      .execute();
    for (const row of rows) {
      const list = result.get(row.sale_id!) ?? [];
      list.push({ serial: row.serial, warrantyEnds: row.warranty_ends });
      result.set(row.sale_id!, list);
    }
    return result;
  }

  /** Records serials coming in, from a bill, a delivery or a stock in (or none of them). */
  async add(
    input: { productId: number; serials: string[]; billId?: number | null; stockDocumentId?: number | null; orderId?: number | null },
    actorId: number,
    now = new Date(),
  ): Promise<AddSerialsResult> {
    return this.transactions.run(async (repos) => {
      await assertOn(repos);
      const product = await repos.products.findById(input.productId, true);
      if (!product) throw new NotFoundError(`Product ${input.productId} does not exist`);
      const serials = [...new Map(input.serials.map(clean).filter(Boolean).map((serial) => [serial.toLowerCase(), serial])).values()];
      const alreadyInStock: string[] = [];
      let added = 0;
      for (const serial of serials) {
        const found = await findSerial(repos, product.id, serial);
        const source = { bill_id: input.billId ?? null, stock_document_id: input.stockDocumentId ?? null, order_id: input.orderId ?? null, came_on: zonedDay(now, this.timeZone) };
        if (found?.status === 'in_stock') {
          alreadyInStock.push(found.serial);
          continue;
        }
        if (found) {
          // Sold before and back again (bought back, or a return not recorded as one).
          await repos.db.updateTable('serials').set({ status: 'in_stock', returned_at: now, ...source }).where('id', '=', found.id).execute();
        } else {
          await repos.db.insertInto('serials').values({ product_id: product.id, serial, created_by: actorId, ...source }).execute();
        }
        added += 1;
      }
      if (added > 0) {
        await repos.activityLog.create({
          userId: actorId,
          action: 'serial.added',
          entityType: 'product',
          entityId: product.id,
          say: { key: 'serialsAdded', params: { product: product.name, count: added } },
          details: { serials, billId: input.billId ?? null, stockDocumentId: input.stockDocumentId ?? null, orderId: input.orderId ?? null },
        });
      }
      return { added, alreadyInStock };
    });
  }

  /** Takes away a serial typed by mistake: only one that was never sold. */
  async remove(id: number, actorId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      const row = await repos.db
        .selectFrom('serials as s')
        .innerJoin('products as p', 'p.id', 's.product_id')
        .select(['s.id', 's.serial', 's.status', 's.sale_id', 's.product_id', 'p.name'])
        .where('s.id', '=', id)
        .executeTakeFirst();
      if (!row) throw new NotFoundError(`Serial ${id} does not exist`);
      if (row.status === 'sold' || row.sale_id !== null) throw new ConflictError(`${row.serial} has been sold, so it stays on record`);
      await repos.db.deleteFrom('serials').where('id', '=', id).execute();
      await repos.activityLog.create({
        userId: actorId,
        action: 'serial.removed',
        entityType: 'product',
        entityId: row.product_id,
        say: { key: 'serialRemoved', params: { product: row.name, serial: row.serial } },
        details: { serial: row.serial },
      });
    });
  }

  private query() {
    return this.db
      .selectFrom('serials as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .leftJoin('supplier_bills as b', 'b.id', 's.bill_id')
      .leftJoin('suppliers as sp', 'sp.id', 'b.supplier_id')
      .leftJoin('stock_documents as sd', 'sd.id', 's.stock_document_id')
      .leftJoin('documents as d', 'd.id', 's.document_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .select([
        's.id',
        's.serial',
        's.product_id',
        'p.name as product_name',
        's.status',
        sql<string | null>`to_char(s.came_on, 'YYYY-MM-DD')`.as('came_on'),
        's.bill_id',
        'b.number as bill_number',
        'sp.name as supplier_name',
        's.stock_document_id',
        'sd.number as stock_document_number',
        's.order_id',
        's.sale_id',
        's.sold_at',
        's.document_id',
        'd.number as document_number',
        's.customer_id',
        'c.name as customer_name',
        sql<string | null>`to_char(s.warranty_ends, 'YYYY-MM-DD')`.as('warranty_ends'),
        's.returned_at',
      ]);
  }

  private toDto(row: Awaited<ReturnType<ReturnType<SerialService['query']>['executeTakeFirstOrThrow']>>): SerialDto {
    const today = zonedDay(new Date(), this.timeZone);
    return {
      id: row.id,
      serial: row.serial,
      productId: row.product_id,
      productName: row.product_name,
      status: row.status,
      cameOn: row.came_on,
      bill: row.bill_id === null ? null : { id: row.bill_id, number: row.bill_number, supplier: row.supplier_name },
      stockDocument: row.stock_document_id === null ? null : { id: row.stock_document_id, number: row.stock_document_number ?? '' },
      orderId: row.order_id,
      saleId: row.sale_id,
      soldAt: row.sold_at?.toISOString() ?? null,
      invoice: row.document_id === null ? null : { id: row.document_id, number: row.document_number ?? '' },
      customer: row.customer_id === null ? null : { id: row.customer_id, name: row.customer_name ?? '' },
      warrantyEnds: row.warranty_ends,
      underWarranty: row.status === 'sold' && row.warranty_ends !== null && row.warranty_ends >= today,
      returnedAt: row.returned_at?.toISOString() ?? null,
    };
  }
}

async function assertOn(repos: TransactionalRepositories): Promise<void> {
  if (!(await readRules(repos.settings)).features.serials) throw new ValidationError('Serial numbers are switched off in Settings');
}

async function findSerial(repos: TransactionalRepositories, productId: number, serial: string) {
  return repos.db
    .selectFrom('serials')
    .select(['id', 'serial', 'status', 'document_id'])
    .where('product_id', '=', productId)
    .where(sql<boolean>`lower(serial) = ${serial.toLowerCase()}`)
    .forUpdate()
    .executeTakeFirst();
}

/** The day `months` after `day` ("YYYY-MM-DD"), on the last day of a shorter month. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Stamps a sale line's serials as sold: the serials a product with serial
 * numbers needs, one per unit. A serial not recorded yet is added as it is
 * sold; one sold and not returned is refused. Offline sales may come without
 * them (the Counter could not check), and are taken as they are.
 */
export async function sellSerials(
  repos: TransactionalRepositories,
  p: { productId: number; quantity: number; serials: string[] | undefined; saleId: number; documentId: number | null; customerId: number | null; soldAt: Date; offline: boolean; timeZone: string; actorId: number },
): Promise<void> {
  if (!(await readRules(repos.settings)).features.serials) return;
  const product = await repos.db.selectFrom('products').select(['name', 'has_serials', 'warranty_months']).where('id', '=', p.productId).executeTakeFirst();
  if (!product?.has_serials) return;
  const serials = (p.serials ?? []).map(clean).filter(Boolean);
  if (new Set(serials.map((serial) => serial.toLowerCase())).size !== serials.length) throw new ValidationError(`The same serial number is on ${product.name} twice`);
  if (serials.length !== p.quantity && !(p.offline && serials.length <= p.quantity)) {
    throw new ValidationError(`${product.name} needs ${p.quantity === 1 ? 'its serial number' : `${p.quantity} serial numbers, one for each`}`);
  }
  const day = zonedDay(p.soldAt, p.timeZone);
  const warrantyEnds = product.warranty_months ? addMonths(day, product.warranty_months) : null;
  const sold = { status: 'sold' as const, sale_id: p.saleId, document_id: p.documentId, customer_id: p.customerId, sold_at: p.soldAt, warranty_ends: warrantyEnds, returned_at: null };
  for (const serial of serials) {
    const found = await findSerial(repos, p.productId, serial);
    if (found?.status === 'sold') {
      const invoice = found.document_id === null ? undefined : await repos.db.selectFrom('documents').select('number').where('id', '=', found.document_id).executeTakeFirst();
      throw new ConflictError(`${product.name} ${found.serial} was already sold${invoice ? ` on ${invoice.number}` : ''} and not returned`);
    }
    if (found) await repos.db.updateTable('serials').set(sold).where('id', '=', found.id).execute();
    else await repos.db.insertInto('serials').values({ product_id: p.productId, serial, created_by: p.actorId, ...sold }).execute();
  }
}

/** A return or an undone sale: its serials go back into stock (the last `quantity` of them, or all). */
export async function returnSerials(repos: TransactionalRepositories, saleId: number, quantity: number | null, now: Date): Promise<void> {
  let query = repos.db.selectFrom('serials').select('id').where('sale_id', '=', saleId).where('status', '=', 'sold').orderBy('id', 'desc');
  if (quantity !== null) query = query.limit(Math.max(0, Math.floor(quantity)));
  const ids = (await query.execute()).map((row) => row.id);
  if (ids.length > 0) await repos.db.updateTable('serials').set({ status: 'in_stock', returned_at: now }).where('id', 'in', ids).execute();
}

/** An undone sale put back: its serials count as sold again, if nobody sold them since. */
export async function resellSerials(repos: TransactionalRepositories, saleId: number): Promise<void> {
  await repos.db.updateTable('serials').set({ status: 'sold', returned_at: null }).where('sale_id', '=', saleId).where('status', '=', 'in_stock').execute();
}
