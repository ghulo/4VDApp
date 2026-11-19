import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { DocumentKind, DocumentPaymentMethod, PortalOrderStatus } from '../database/types.js';

/**
 * Step 15, the business customers' portal. Every query that reads a
 * customer's things takes the customer id and filters on it, so the portal
 * service can never ask for another customer's rows by mistake.
 */

export interface PortalUserRecord {
  id: number;
  business_id: number;
  customer_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  language: 'sq' | 'en';
  created_at: Date;
  last_seen_at: Date | null;
}

/** A signed-in person with what their customer allows, read fresh on every request. */
export interface PortalPrincipalRecord extends PortalUserRecord {
  session_id: number;
  customer_name: string;
  portal_enabled: boolean;
  portal_can_order: boolean;
  portal_min_order: string | null;
  portal_categories: number[] | null;
  pays_wholesale: boolean;
  archived_at: Date | null;
}

export interface PortalSettingsRecord {
  id: number;
  name: string;
  kind: 'person' | 'business';
  archived_at: Date | null;
  portal_enabled: boolean;
  portal_can_order: boolean;
  portal_min_order: string | null;
  portal_categories: number[] | null;
  pays_wholesale: boolean;
}

export interface PortalProductRecord {
  id: number;
  name: string;
  category_id: number;
  category_name: string;
  image_url: string | null;
  unit: string;
  vat_rate: number;
  base_price: string;
  wholesale_price: string | null;
  quantity_on_hand: number;
}

export interface PortalOrderRecord {
  id: number;
  customer_id: number;
  customer_name: string;
  portal_user_id: number | null;
  person_name: string | null;
  note: string | null;
  status: PortalOrderStatus;
  net: string;
  vat: string;
  total: string;
  seen_at: Date | null;
  decided_at: Date | null;
  decline_reason: string | null;
  offer_id: number | null;
  change_reason: string | null;
  changed_at: Date | null;
  change_seen_at: Date | null;
  change_agreed_at: Date | null;
  previous: PortalOrderSnapshot | null;
  offer_number: string | null;
  offer_status: 'open' | 'sold' | 'declined' | null;
  offer_total: string | null;
  sale_document_id: number | null;
  sale_number: string | null;
  delivery_status: 'waiting' | 'on_the_way' | 'delivered' | null;
  deliver_on: string | null;
  line_count: number;
  created_at: Date;
}

export interface PortalOrderLineRecord {
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: string;
  vat_rate: string;
  total: string;
  in_stock: boolean;
}

/** An order as the customer last agreed it, kept when the shop changes it. */
export interface PortalOrderSnapshot {
  net: number;
  vat: number;
  total: number;
  lines: Array<{ productId: number; name: string; unit: string; quantity: number; unitPrice: number; total: number }>;
}

export type NewPortalOrderLine = { productId: number; productName: string; unit: string; quantity: number; unitPrice: number; vatRate: number; total: number; inStock: boolean };

export interface PortalDocumentRecord {
  id: number;
  kind: DocumentKind;
  number: string;
  issued_at: Date;
  due_date: string | null;
  net_total: string;
  vat_total: string;
  total: string;
  payment_method: DocumentPaymentMethod;
  corrects_number: string | null;
}

export interface NewPortalOrder {
  customerId: number;
  portalUserId: number;
  note: string | null;
  net: number;
  vat: number;
  total: number;
  lines: NewPortalOrderLine[];
}

const USER_COLUMNS = ['u.id', 'u.business_id', 'u.customer_id', 'u.name', 'u.email', 'u.phone', 'u.language', 'u.created_at', 'u.last_seen_at'] as const;

export class PortalRepository {
  constructor(private readonly db: DatabaseClient) {}

  // People

  listUsers(customerId: number): Promise<PortalUserRecord[]> {
    return this.db
      .selectFrom('portal_users as u')
      .select(USER_COLUMNS)
      .where('u.customer_id', '=', customerId)
      .where('u.removed_at', 'is', null)
      .orderBy('u.id')
      .execute();
  }

  findUser(id: number): Promise<PortalUserRecord | undefined> {
    return this.db.selectFrom('portal_users as u').select(USER_COLUMNS).where('u.id', '=', id).where('u.removed_at', 'is', null).executeTakeFirst();
  }

  /** Someone who may be sent a sign-in link: not removed, and their customer has the portal on. */
  /** Every business's portal person with this email (a customer of two shops has one in each). */
  findUsersByEmail(email: string): Promise<PortalUserRecord[]> {
    return this.db
      .selectFrom('portal_users as u')
      .innerJoin('customers as c', 'c.id', 'u.customer_id')
      .select(USER_COLUMNS)
      .where(sql<boolean>`lower(u.email) = lower(${email})`)
      .where('u.removed_at', 'is', null)
      .where('c.portal_enabled', '=', true)
      .where('c.archived_at', 'is', null)
      .orderBy('u.business_id')
      .execute();
  }

  async emailTaken(email: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('portal_users')
      .select('id')
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    return row !== undefined;
  }

  async createUser(input: { customerId: number; name: string; email: string | null; phone: string | null; language: 'sq' | 'en'; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('portal_users')
      .values({ customer_id: input.customerId, name: input.name, email: input.email, phone: input.phone, language: input.language, created_by: input.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async removeUser(id: number, now: Date): Promise<void> {
    await this.db.updateTable('portal_users').set({ removed_at: now }).where('id', '=', id).execute();
    await this.revokeSessionsOf([id], now);
    await this.db.deleteFrom('portal_links').where('portal_user_id', '=', id).where('used_at', 'is', null).execute();
  }

  async setLanguage(id: number, language: 'sq' | 'en'): Promise<void> {
    await this.db.updateTable('portal_users').set({ language }).where('id', '=', id).execute();
  }

  // One-time links

  async createLink(portalUserId: number, purpose: 'invite' | 'sign_in', tokenHash: string, expiresAt: Date): Promise<void> {
    // A new link replaces older unused ones of the same kind.
    await this.db.deleteFrom('portal_links').where('portal_user_id', '=', portalUserId).where('purpose', '=', purpose).where('used_at', 'is', null).execute();
    await this.db.insertInto('portal_links').values({ portal_user_id: portalUserId, purpose, token_hash: tokenHash, expires_at: expiresAt }).execute();
  }

  /** Whose business a link (still unused) belongs to: read before anyone is signed in. */
  async linkBusiness(tokenHash: string): Promise<number | undefined> {
    const row = await this.db.selectFrom('portal_links').select('business_id').where('token_hash', '=', tokenHash).where('used_at', 'is', null).executeTakeFirst();
    return row?.business_id;
  }

  /** Whose business a session belongs to: read before anyone is signed in. */
  async sessionBusiness(tokenHash: string): Promise<number | undefined> {
    const row = await this.db.selectFrom('portal_sessions').select('business_id').where('token_hash', '=', tokenHash).executeTakeFirst();
    return row?.business_id;
  }

  /** Spends a link at most once: two taps at the same moment can't both sign in. */
  async useLink(tokenHash: string, now: Date): Promise<{ portal_user_id: number; purpose: 'invite' | 'sign_in' } | undefined> {
    return this.db
      .updateTable('portal_links')
      .set({ used_at: now })
      .where('token_hash', '=', tokenHash)
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .returning(['portal_user_id', 'purpose'])
      .executeTakeFirst();
  }

  /** The link exists and still works, without spending it (the page before the button). */
  async peekLink(tokenHash: string, now: Date): Promise<{ purpose: 'invite' | 'sign_in'; customer_name: string; person_name: string } | undefined> {
    return this.db
      .selectFrom('portal_links as l')
      .innerJoin('portal_users as u', 'u.id', 'l.portal_user_id')
      .innerJoin('customers as c', 'c.id', 'u.customer_id')
      .select(['l.purpose', 'c.name as customer_name', 'u.name as person_name'])
      .where('l.token_hash', '=', tokenHash)
      .where('l.used_at', 'is', null)
      .where('l.expires_at', '>', now)
      .where('u.removed_at', 'is', null)
      .where('c.portal_enabled', '=', true)
      .executeTakeFirst();
  }

  async pendingInvites(customerId: number, now: Date): Promise<Map<number, Date>> {
    const rows = await this.db
      .selectFrom('portal_links as l')
      .innerJoin('portal_users as u', 'u.id', 'l.portal_user_id')
      .select(['l.portal_user_id', 'l.expires_at'])
      .where('u.customer_id', '=', customerId)
      .where('l.purpose', '=', 'invite')
      .where('l.used_at', 'is', null)
      .where('l.expires_at', '>', now)
      .execute();
    return new Map(rows.map((row) => [row.portal_user_id, row.expires_at]));
  }

  // Sessions

  async createSession(portalUserId: number, tokenHash: string, expiresAt: Date, now: Date): Promise<void> {
    await this.db.insertInto('portal_sessions').values({ portal_user_id: portalUserId, token_hash: tokenHash, expires_at: expiresAt }).execute();
    await this.db.updateTable('portal_users').set({ last_seen_at: now }).where('id', '=', portalUserId).execute();
  }

  findPrincipal(tokenHash: string, now: Date): Promise<PortalPrincipalRecord | undefined> {
    return this.db
      .selectFrom('portal_sessions as s')
      .innerJoin('portal_users as u', 'u.id', 's.portal_user_id')
      .innerJoin('customers as c', 'c.id', 'u.customer_id')
      .select([
        ...USER_COLUMNS,
        's.id as session_id',
        'c.name as customer_name',
        'c.portal_enabled',
        'c.portal_can_order',
        'c.portal_min_order',
        'c.portal_categories',
        'c.pays_wholesale',
        'c.archived_at',
      ])
      .where('s.token_hash', '=', tokenHash)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', now)
      .where('u.removed_at', 'is', null)
      .executeTakeFirst();
  }

  async touchSession(sessionId: number, portalUserId: number, now: Date): Promise<void> {
    await this.db.updateTable('portal_sessions').set({ last_used_at: now }).where('id', '=', sessionId).execute();
    await this.db.updateTable('portal_users').set({ last_seen_at: now }).where('id', '=', portalUserId).execute();
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.db.updateTable('portal_sessions').set({ revoked_at: now }).where('token_hash', '=', tokenHash).where('revoked_at', 'is', null).execute();
  }

  async revokeSessionsOf(portalUserIds: number[], now: Date): Promise<void> {
    if (portalUserIds.length === 0) return;
    await this.db.updateTable('portal_sessions').set({ revoked_at: now }).where('portal_user_id', 'in', portalUserIds).where('revoked_at', 'is', null).execute();
  }

  async revokeCustomerSessions(customerId: number, now: Date): Promise<void> {
    await this.db
      .updateTable('portal_sessions')
      .set({ revoked_at: now })
      .where('revoked_at', 'is', null)
      .where('portal_user_id', 'in', this.db.selectFrom('portal_users').select('id').where('customer_id', '=', customerId))
      .execute();
  }

  // What the shop allows

  findSettings(customerId: number): Promise<PortalSettingsRecord | undefined> {
    return this.db
      .selectFrom('customers')
      .select(['id', 'name', 'kind', 'archived_at', 'portal_enabled', 'portal_can_order', 'portal_min_order', 'portal_categories', 'pays_wholesale'])
      .where('id', '=', customerId)
      .executeTakeFirst();
  }

  async saveSettings(customerId: number, s: { enabled: boolean; canOrder: boolean; minOrder: number | null; categories: number[] | null }): Promise<void> {
    await this.db
      .updateTable('customers')
      .set({ portal_enabled: s.enabled, portal_can_order: s.canOrder, portal_min_order: s.minOrder, portal_categories: s.categories })
      .where('id', '=', customerId)
      .execute();
  }

  async existingCategories(ids: number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.selectFrom('categories').select('id').where('id', 'in', ids).execute();
    return rows.map((row) => row.id);
  }

  // Products

  /** Products on sale that this customer may see. Never selects cost. */
  products(filter: { categories: number[] | null; search?: string; categoryId?: number; ids?: number[] }): Promise<PortalProductRecord[]> {
    let query = this.db
      .selectFrom('products as p')
      .innerJoin('categories as c', 'c.id', 'p.category_id')
      .leftJoin('inventory as i', 'i.product_id', 'p.id')
      .select([
        'p.id',
        'p.name',
        'p.category_id',
        'c.name as category_name',
        'p.image_url',
        'p.unit',
        'p.vat_rate',
        'p.base_price',
        'p.wholesale_price',
        sql<number>`coalesce(i.quantity_on_hand, 0)`.as('quantity_on_hand'),
      ])
      .where('p.is_active', '=', true)
      .where('p.deleted_at', 'is', null);
    if (filter.categories) query = query.where('p.category_id', 'in', filter.categories.length > 0 ? filter.categories : [-1]);
    if (filter.categoryId !== undefined) query = query.where('p.category_id', '=', filter.categoryId);
    if (filter.ids) query = query.where('p.id', 'in', filter.ids.length > 0 ? filter.ids : [-1]);
    if (filter.search) {
      const pattern = `%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) => eb.or([eb('p.name', 'ilike', pattern), eb('p.barcode', '=', filter.search!), eb('p.sku', '=', filter.search!)]));
    }
    return query.orderBy('c.name').orderBy('p.name').limit(filter.ids ? 500 : 300).execute();
  }

  async categories(allowed: number[] | null): Promise<Array<{ id: number; name: string }>> {
    let query = this.db
      .selectFrom('categories as c')
      .select(['c.id', 'c.name'])
      .where((eb) => eb.exists(eb.selectFrom('products as p').select('p.id').whereRef('p.category_id', '=', 'c.id').where('p.is_active', '=', true).where('p.deleted_at', 'is', null)));
    if (allowed) query = query.where('c.id', 'in', allowed.length > 0 ? allowed : [-1]);
    return query.orderBy('c.name').execute();
  }

  allCategories(): Promise<Array<{ id: number; name: string }>> {
    return this.db.selectFrom('categories').select(['id', 'name']).orderBy('name').execute();
  }

  // Orders

  async createOrder(order: NewPortalOrder): Promise<number> {
    const row = await this.db
      .insertInto('portal_orders')
      .values({ customer_id: order.customerId, portal_user_id: order.portalUserId, note: order.note, net: order.net, vat: order.vat, total: order.total })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.insertLines(row.id, order.lines);
    return row.id;
  }

  private async insertLines(orderId: number, lines: NewPortalOrderLine[]): Promise<void> {
    if (lines.length === 0) return;
    await this.db
      .insertInto('portal_order_lines')
      .values(
        lines.map((line) => ({
          order_id: orderId,
          product_id: line.productId,
          product_name: line.productName,
          unit: line.unit,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          vat_rate: line.vatRate,
          total: line.total,
          in_stock: line.inStock,
        })),
      )
      .execute();
  }

  /**
   * The shop's change: new lines and totals, and the order waits for the
   * customer. `previous` is left as it is when the order already waits (a
   * second change still compares with what the customer agreed).
   */
  async replaceLines(
    id: number,
    change: { net: number; vat: number; total: number; lines: NewPortalOrderLine[]; reason: string; userId: number; previous: PortalOrderSnapshot | null },
    now: Date,
  ): Promise<void> {
    await this.db.deleteFrom('portal_order_lines').where('order_id', '=', id).execute();
    await this.insertLines(id, change.lines);
    await this.db
      .updateTable('portal_orders')
      .set({
        status: 'changed',
        net: change.net,
        vat: change.vat,
        total: change.total,
        change_reason: change.reason,
        changed_at: now,
        changed_by: change.userId,
        change_seen_at: null,
        change_agreed_at: null,
        seen_at: sql<Date>`coalesce(seen_at, ${now})`,
        seen_by: sql<number>`coalesce(seen_by, ${change.userId})`,
        ...(change.previous && { previous: JSON.stringify(change.previous) }),
      })
      .where('id', '=', id)
      .execute();
  }

  /** The customer opened a changed order. */
  async markChangeSeen(id: number, customerId: number, now: Date): Promise<void> {
    await this.db
      .updateTable('portal_orders')
      .set({ change_seen_at: now })
      .where('id', '=', id)
      .where('customer_id', '=', customerId)
      .where('status', '=', 'changed')
      .where('change_seen_at', 'is', null)
      .execute();
  }

  /** The customer agreed to the change: it goes back to the shop, seen. */
  async agreeChange(id: number, now: Date): Promise<void> {
    await this.db
      .updateTable('portal_orders')
      .set({ status: 'seen', change_agreed_at: now, change_seen_at: sql<Date>`coalesce(change_seen_at, ${now})` })
      .where('id', '=', id)
      .where('status', '=', 'changed')
      .execute();
  }

  /** Changed orders this customer hasn't opened yet, for the dot on Orders. */
  async unseenChanges(customerId: number): Promise<number> {
    const row = await this.db
      .selectFrom('portal_orders')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('customer_id', '=', customerId)
      .where('status', '=', 'changed')
      .where('change_seen_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  private orderSelect() {
    return sql`
      select o.id, o.customer_id, c.name as customer_name, o.portal_user_id, u.name as person_name, o.note, o.status,
        o.net, o.vat, o.total, o.seen_at, o.decided_at, o.decline_reason, o.offer_id,
        o.change_reason, o.changed_at, o.change_seen_at, o.change_agreed_at, o.previous,
        f.number as offer_number, f.status as offer_status, f.total as offer_total,
        f.sale_document_id, d.number as sale_number, x.status as delivery_status, to_char(x.deliver_on, 'YYYY-MM-DD') as deliver_on,
        (select count(*)::int from portal_order_lines l where l.order_id = o.id) as line_count, o.created_at
      from portal_orders o
      join customers c on c.id = o.customer_id
      left join portal_users u on u.id = o.portal_user_id
      left join offers f on f.id = o.offer_id
      left join documents d on d.id = f.sale_document_id
      left join customer_deliveries x on x.document_id = f.sale_document_id`;
  }

  async ordersOf(customerId: number, limit = 100): Promise<PortalOrderRecord[]> {
    const { rows } = await sql<PortalOrderRecord>`${this.orderSelect()} where o.customer_id = ${customerId} order by o.created_at desc, o.id desc limit ${limit}`.execute(this.db);
    return rows;
  }

  /** One order, only when it belongs to this customer (null: any customer, for the shop's side). */
  async findOrder(id: number, customerId: number | null, forUpdate = false): Promise<PortalOrderRecord | undefined> {
    const { rows } = await sql<PortalOrderRecord>`${this.orderSelect()} where o.id = ${id} ${customerId === null ? sql`` : sql`and o.customer_id = ${customerId}`} ${forUpdate ? sql`for update of o` : sql``}`.execute(this.db);
    return rows[0];
  }

  async orderLines(orderId: number): Promise<PortalOrderLineRecord[]> {
    return this.db
      .selectFrom('portal_order_lines')
      .select(['product_id', 'product_name', 'unit', 'quantity', 'unit_price', 'vat_rate', 'total', 'in_stock'])
      .where('order_id', '=', orderId)
      .orderBy('id')
      .execute();
  }

  async openOrders(): Promise<PortalOrderRecord[]> {
    const { rows } = await sql<PortalOrderRecord>`${this.orderSelect()} where o.status in ('sent', 'seen') order by o.created_at, o.id`.execute(this.db);
    return rows;
  }

  async recentOrders(limit = 100): Promise<PortalOrderRecord[]> {
    const { rows } = await sql<PortalOrderRecord>`${this.orderSelect()} order by o.created_at desc, o.id desc limit ${limit}`.execute(this.db);
    return rows;
  }

  async markSeen(id: number, userId: number, now: Date): Promise<void> {
    await this.db.updateTable('portal_orders').set({ status: 'seen', seen_at: now, seen_by: userId }).where('id', '=', id).where('status', '=', 'sent').execute();
  }

  async decide(id: number, patch: { status: 'accepted' | 'declined' | 'cancelled'; userId: number | null; reason?: string | null; offerId?: number | null }, now: Date): Promise<void> {
    await this.db
      .updateTable('portal_orders')
      .set({ status: patch.status, decided_at: now, decided_by: patch.userId, decline_reason: patch.reason ?? null, offer_id: patch.offerId ?? null })
      .where('id', '=', id)
      .execute();
  }

  /** The shop's own details, shown to customers (where to pay, whom to call). */
  async shop() {
    const row = await this.db
      .selectFrom('businesses')
      .select(['name', 'phone', 'address', 'bank_name', 'iban', 'display_name', 'short_name', 'brand_colour', 'brand_accent', 'brand_gradient', 'brand_greys', 'logo_media_id'])
      .where('id', '=', sql<number>`current_business_id()`)
      .executeTakeFirst();
    return row ?? { name: '4VD', phone: null, address: null, bank_name: null, iban: null, display_name: null, short_name: '4vd', brand_colour: null, brand_accent: null, brand_gradient: false, brand_greys: null, logo_media_id: null };
  }

  async reopen(id: number, status: 'sent' | 'seen'): Promise<void> {
    await this.db.updateTable('portal_orders').set({ status, decided_at: null, decided_by: null, offer_id: null }).where('id', '=', id).execute();
  }

  // Invoices

  documentsOf(customerId: number, limit = 200): Promise<PortalDocumentRecord[]> {
    return this.db
      .selectFrom('documents as d')
      .leftJoin('documents as k', 'k.id', 'd.corrects_id')
      .select([
        'd.id',
        'd.kind',
        'd.number',
        'd.issued_at',
        sql<string | null>`to_char(d.due_date, 'YYYY-MM-DD')`.as('due_date'),
        'd.net_total',
        'd.vat_total',
        'd.total',
        'd.payment_method',
        'k.number as corrects_number',
      ])
      .where('d.customer_id', '=', customerId)
      .orderBy('d.issued_at', 'desc')
      .orderBy('d.id', 'desc')
      .limit(limit)
      .execute() as Promise<PortalDocumentRecord[]>;
  }

  async documentBelongsTo(documentId: number, customerId: number): Promise<boolean> {
    const row = await this.db.selectFrom('documents').select('id').where('id', '=', documentId).where('customer_id', '=', customerId).executeTakeFirst();
    return row !== undefined;
  }
}
