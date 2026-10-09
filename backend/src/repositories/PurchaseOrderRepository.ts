import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export type OrderStatus = 'open' | 'received' | 'cancelled';

export type SupplierFields = Omit<SupplierRecord, 'id'>;

export interface SupplierRecord {
  id: number;
  name: string;
  nui: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
}

export interface OrderRecord {
  id: number;
  supplier_id: number;
  supplier_name: string;
  supplier_phone: string | null;
  supplier_email: string | null;
  status: OrderStatus;
  note: string | null;
  created_by_name: string | null;
  created_at: Date;
  closed_by_name: string | null;
  closed_at: Date | null;
}

/** The supplier's bill for an order, with what is still owed on it. */
export interface OrderBillRecord {
  id: number;
  order_id: number;
  number: string | null;
  amount: string;
  paid: string;
  due_on: string | null;
}

export interface OrderLineRecord {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_cost: string | null;
  received_quantity: number | null;
}

export class PurchaseOrderRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findSuppliers(): Promise<SupplierRecord[]> {
    return this.db
      .selectFrom('suppliers')
      .select(['id', 'name', 'nui', 'phone', 'email', 'note'])
      .where('archived_at', 'is', null)
      .orderBy('name')
      .execute();
  }

  async findSupplier(id: number): Promise<SupplierRecord | undefined> {
    return this.db
      .selectFrom('suppliers')
      .select(['id', 'name', 'nui', 'phone', 'email', 'note'])
      .where('id', '=', id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
  }

  async createSupplier(input: SupplierFields): Promise<number> {
    const row = await this.db.insertInto('suppliers').values(input).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async updateSupplier(id: number, changes: SupplierFields): Promise<void> {
    await this.db.updateTable('suppliers').set(changes).where('id', '=', id).execute();
  }

  async archiveSupplier(id: number, at: Date): Promise<void> {
    await this.db.updateTable('suppliers').set({ archived_at: at }).where('id', '=', id).execute();
  }

  private ordersQuery() {
    return this.db
      .selectFrom('purchase_orders as o')
      .innerJoin('suppliers as s', 's.id', 'o.supplier_id')
      .leftJoin('users as u', 'u.id', 'o.created_by')
      .leftJoin('users as c', 'c.id', 'o.closed_by')
      .select([
        'o.id',
        'o.supplier_id',
        's.name as supplier_name',
        's.phone as supplier_phone',
        's.email as supplier_email',
        'o.status',
        'o.note',
        'u.name as created_by_name',
        'o.created_at',
        'c.name as closed_by_name',
        'o.closed_at',
      ]);
  }

  /** Open orders first (oldest first), then the most recent closed ones. */
  async findOrders(closedLimit: number): Promise<OrderRecord[]> {
    const [open, closed] = await Promise.all([
      this.ordersQuery().where('o.status', '=', 'open').orderBy('o.created_at').execute(),
      this.ordersQuery().where('o.status', '!=', 'open').orderBy('o.closed_at', 'desc').limit(closedLimit).execute(),
    ]);
    return [...open, ...closed];
  }

  async findOrder(id: number): Promise<OrderRecord | undefined> {
    return this.ordersQuery().where('o.id', '=', id).executeTakeFirst();
  }

  /** Bills for these orders; voided ones left out. */
  async findBills(orderIds: number[]): Promise<OrderBillRecord[]> {
    if (orderIds.length === 0) return [];
    return this.db
      .selectFrom('supplier_bills as b')
      .select([
        'b.id',
        'b.order_id',
        'b.number',
        'b.amount',
        sql<string>`coalesce((select sum(p.amount) from supplier_payments p where p.bill_id = b.id and p.voided_at is null), 0)`.as('paid'),
        sql<string | null>`to_char(b.due_on, 'YYYY-MM-DD')`.as('due_on'),
      ])
      .where('b.order_id', 'in', orderIds)
      .where('b.voided_at', 'is', null)
      .execute() as Promise<OrderBillRecord[]>;
  }

  async findLines(orderIds: number[]): Promise<OrderLineRecord[]> {
    if (orderIds.length === 0) return [];
    return this.db
      .selectFrom('purchase_order_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.id', 'l.order_id', 'l.product_id', 'p.name as product_name', 'p.sku', 'l.quantity', 'l.unit_cost', 'l.received_quantity'])
      .where('l.order_id', 'in', orderIds)
      .orderBy('p.name')
      .execute();
  }

  async createOrder(input: {
    supplierId: number;
    note: string | null;
    createdBy: number;
    lines: Array<{ productId: number; quantity: number; unitCost: number | null }>;
  }): Promise<number> {
    const order = await this.db
      .insertInto('purchase_orders')
      .values({ supplier_id: input.supplierId, note: input.note, created_by: input.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db
      .insertInto('purchase_order_lines')
      .values(
        input.lines.map((line) => ({ order_id: order.id, product_id: line.productId, quantity: line.quantity, unit_cost: line.unitCost })),
      )
      .execute();
    return order.id;
  }

  async setReceived(lineId: number, receivedQuantity: number, unitCost: number | null): Promise<void> {
    await this.db
      .updateTable('purchase_order_lines')
      .set({ received_quantity: receivedQuantity, unit_cost: unitCost })
      .where('id', '=', lineId)
      .execute();
  }

  async close(id: number, status: 'received' | 'cancelled', by: number, at: Date): Promise<void> {
    await this.db.updateTable('purchase_orders').set({ status, closed_by: by, closed_at: at }).where('id', '=', id).execute();
  }

  async setCostPrice(productId: number, cost: number): Promise<void> {
    await this.db.updateTable('products').set({ cost_price: cost, updated_at: new Date() }).where('id', '=', productId).execute();
  }

  /** Who each product was last ordered from, so a new order can suggest the usual supplier. */
  async lastSupplierByProduct(): Promise<Map<number, number>> {
    const rows = await this.db
      .selectFrom('purchase_order_lines as l')
      .innerJoin('purchase_orders as o', 'o.id', 'l.order_id')
      .select(['l.product_id', 'o.supplier_id'])
      .where('o.status', '!=', 'cancelled')
      .orderBy('o.created_at', 'asc')
      .execute();
    // Later orders overwrite earlier ones.
    return new Map(rows.map((row) => [row.product_id, row.supplier_id]));
  }
}
