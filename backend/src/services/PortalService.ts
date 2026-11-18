import { NOTIFICATION_TYPES } from '../constants/notifications.js';
import { enterBusiness, runAsBusiness } from '../database/businessContext.js';
import { allowsParts } from '../constants/units.js';
import type { ProductUnit } from '../database/types.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { messages } from '../i18n/messages.js';
import { money as formatMoney } from '../i18n/language.js';
import type { PricingTierRepository } from '../repositories/PricingTierRepository.js';
import type {
  PortalDocumentRecord,
  PortalOrderLineRecord,
  PortalOrderRecord,
  PortalOrderSnapshot,
  PortalPrincipalRecord,
  PortalProductRecord,
  PortalRepository,
} from '../repositories/PortalRepository.js';
import type { TabRepository } from '../repositories/TabRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { rolesWith } from '../utils/roles.js';
import { generateRefreshToken, hashRefreshToken } from '../utils/tokens.js';
import { zonedDay } from '../utils/zonedDates.js';
import { splitVat } from './documents/vat.js';
import type { DocumentService } from './DocumentService.js';
import type { EmailService } from './email/EmailService.js';
import { emailTemplates } from './email/templates.js';
import { calculateUnitPrice } from './pricing/bulkPricing.js';
import { levelPrice } from './pricing/salePrice.js';
import type { SalesDocumentService } from './SalesDocumentService.js';
import type { TabService } from './TabService.js';

/**
 * Step 15, the portal for business customers (4vd.app/portal).
 *
 * Portal people are not dashboard users: they have no role, no power and no
 * JWT. They sign in with a one-time link and keep an httpOnly cookie whose
 * hash is checked here on every request, together with whether their
 * customer still has the portal on. Everything they read is built from an
 * explicit list of fields, never by spreading a record, so cost and margin
 * can't leak.
 */

export const PORTAL_INVITE_DAYS = 7;
export const PORTAL_SIGN_IN_MINUTES = 15;
export const PORTAL_SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 200;

export type PortalLanguage = 'sq' | 'en';

/** Who is asking, from their cookie. */
export interface PortalPrincipal {
  personId: number;
  sessionId: number;
  customerId: number;
  customerName: string;
  name: string;
  email: string | null;
  language: PortalLanguage;
  canOrder: boolean;
  minOrder: number | null;
  categories: number[] | null;
  paysWholesale: boolean;
}

/** What a customer sees of an order; the shop's own words stay out. */
export type PortalOrderState = 'sent' | 'seen' | 'changed' | 'offered' | 'preparing' | 'on_the_way' | 'delivered' | 'done' | 'declined' | 'cancelled';

export interface PortalProductDto {
  id: number;
  name: string;
  category: { id: number; name: string };
  imageUrl: string | null;
  unit: ProductUnit;
  vatRate: number;
  /** With VAT, at this customer's price level. */
  price: number;
  /** The same without VAT. */
  net: number;
  inStock: boolean;
}

export interface PricedLine {
  productId: number;
  name: string;
  unit: ProductUnit;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  net: number;
  vat: number;
  total: number;
  inStock: boolean;
}

export interface PortalQuoteDto {
  lines: PricedLine[];
  net: number;
  vat: number;
  total: number;
  /** Products asked for that are no longer offered to this customer. */
  missing: number[];
  minOrder: number | null;
  canOrder: boolean;
}

export interface PortalOrderDto {
  id: number;
  at: string;
  state: PortalOrderState;
  net: number;
  vat: number;
  total: number;
  note: string | null;
  lineCount: number;
  by: string | null;
  declineReason: string | null;
  offer: { number: string; total: number } | null;
  invoice: { id: number; number: string } | null;
  deliverOn: string | null;
  /** The shop's last change, with what the customer had agreed before it. */
  change: { reason: string; at: string; seen: boolean; agreed: boolean; previous: PortalOrderSnapshot | null } | null;
}

export interface PortalOrderDetailDto extends PortalOrderDto {
  lines: Array<{ productId: number; name: string; unit: string; quantity: number; unitPrice: number; vatRate: number; total: number; inStock: boolean }>;
  canCancel: boolean;
  canAgree: boolean;
}

export interface PortalDocumentDto {
  id: number;
  kind: 'invoice' | 'credit_note';
  number: string;
  issuedAt: string;
  dueDate: string | null;
  net: number;
  vat: number;
  total: number;
  /** Paid at the till (settled) or on account (to pay). */
  onAccount: boolean;
  corrects: string | null;
}

export interface PortalAccountDto {
  balance: number;
  payLater: boolean;
  creditLimit: number | null;
  lateAmount: number;
  lateSince: string | null;
  lastPaymentAt: string | null;
  openItems: Array<{ documentId: number | null; number: string | null; date: string; dueDate: string | null; total: number; paid: number; left: number; late: boolean }>;
  shop: { name: string; bankName: string | null; iban: string | null };
}

export interface PortalStatementDto {
  from: string;
  to: string;
  opening: number;
  closing: number;
  lines: Array<{ date: string; kind: 'charge' | 'payment' | 'refund' | 'credit'; number: string | null; debit: number; credit: number; balance: number }>;
  customer: { name: string };
  shop: { name: string };
}

export interface ShopPortalPersonDto {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  language: PortalLanguage;
  lastSeenAt: string | null;
  invitePending: boolean;
}

export interface ShopPortalDto {
  customerId: number;
  enabled: boolean;
  canOrder: boolean;
  minOrder: number | null;
  /** Null: every category. */
  categories: number[] | null;
  people: ShopPortalPersonDto[];
  allCategories: Array<{ id: number; name: string }>;
}

export interface ShopPortalOrderDto extends PortalOrderDto {
  status: PortalOrderRecord['status'];
  customer: { id: number; name: string };
  offerId: number | null;
}

export interface PortalSettingsInput {
  enabled: boolean;
  canOrder: boolean;
  minOrder: number | null;
  categories: number[] | null;
}

export interface PortalInviteInput {
  name: string;
  email: string | null;
  phone: string | null;
  language: PortalLanguage;
  /** Email the link too (only when there is an address). */
  sendEmail: boolean;
}

const money = (value: string | number | null): number | null => (value === null ? null : Number(value));

export function orderState(o: Pick<PortalOrderRecord, 'status' | 'offer_status' | 'sale_document_id' | 'delivery_status'>): PortalOrderState {
  if (o.status === 'cancelled') return 'cancelled';
  if (o.status === 'declined' || o.offer_status === 'declined') return 'declined';
  if (o.status === 'sent' || o.status === 'seen' || o.status === 'changed') return o.status;
  if (o.offer_status === 'sold' || o.sale_document_id !== null) {
    if (o.delivery_status === 'waiting') return 'preparing';
    if (o.delivery_status === 'on_the_way') return 'on_the_way';
    if (o.delivery_status === 'delivered') return 'delivered';
    return 'done';
  }
  return 'offered';
}

function toOrderDto(o: PortalOrderRecord): PortalOrderDto {
  return {
    id: o.id,
    at: o.created_at.toISOString(),
    state: orderState(o),
    net: Number(o.net),
    vat: Number(o.vat),
    total: Number(o.total),
    note: o.note,
    lineCount: o.line_count,
    by: o.person_name,
    declineReason: o.status === 'declined' ? o.decline_reason : null,
    offer: o.offer_number ? { number: o.offer_number, total: Number(o.offer_total) } : null,
    invoice: o.sale_document_id && o.sale_number ? { id: o.sale_document_id, number: o.sale_number } : null,
    deliverOn: o.deliver_on,
    change:
      o.changed_at && o.change_reason
        ? { reason: o.change_reason, at: o.changed_at.toISOString(), seen: o.change_seen_at !== null, agreed: o.change_agreed_at !== null, previous: o.previous }
        : null,
  };
}

const toLineDto = (l: PortalOrderLineRecord) => ({
  productId: l.product_id,
  name: l.product_name,
  unit: l.unit,
  quantity: l.quantity,
  unitPrice: Number(l.unit_price),
  vatRate: Number(l.vat_rate),
  total: Number(l.total),
  inStock: l.in_stock,
});

function toPrincipal(r: PortalPrincipalRecord): PortalPrincipal {
  return {
    personId: r.id,
    sessionId: r.session_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    name: r.name,
    email: r.email,
    language: r.language,
    canOrder: r.portal_can_order,
    minOrder: money(r.portal_min_order),
    categories: r.portal_categories,
    paysWholesale: r.pays_wholesale,
  };
}

export class PortalService {
  constructor(
    private readonly repository: PortalRepository,
    private readonly tabRepository: TabRepository,
    private readonly pricingTiers: PricingTierRepository,
    private readonly tabService: TabService,
    private readonly salesDocumentService: SalesDocumentService,
    private readonly documentService: DocumentService,
    private readonly emailService: EmailService,
    private readonly transactions: TransactionManager,
    private readonly dashboardUrl: string,
    private readonly timeZone: string,
  ) {}

  // ——— Signing in ———

  private link(token: string, purpose: 'invite' | 'sign_in'): string {
    // In the fragment, so the token never reaches a server log or a Referer header.
    return `${this.dashboardUrl}/portal/${purpose === 'invite' ? 'join' : 'link'}#${token}`;
  }

  /**
   * "Send me a sign-in link". Answers the same whether or not the address is
   * known, so nobody can find out which firms use the portal.
   */
  async requestLink(email: string, now = new Date()): Promise<void> {
    // One link per shop they buy from, each email naming its shop; the answer is the same either way.
    for (const person of await this.repository.findUsersByEmail(email.trim())) {
      const address = person.email;
      if (!address) continue;
      await runAsBusiness(person.business_id, async () => {
        const token = generateRefreshToken();
        await this.repository.createLink(person.id, 'sign_in', hashRefreshToken(token), new Date(now.getTime() + PORTAL_SIGN_IN_MINUTES * 60 * 1000));
        const shop = await this.repository.shop();
        await this.emailService.queue(address, emailTemplates.portalSignIn({ shopName: shop.name, link: this.link(token, 'sign_in') }, messages[person.language]));
      });
    }
  }

  /** The page before the button: is the link still good, and whose is it. Spends nothing. */
  async peek(token: string, now = new Date()): Promise<{ purpose: 'invite' | 'sign_in'; customer: string; name: string; shop: string }> {
    const link = await this.repository.peekLink(hashRefreshToken(token), now);
    if (!link) throw new NotFoundError('This link no longer works. Ask the shop for a new one, or sign in with your email.');
    const shop = await this.repository.shop();
    return { purpose: link.purpose, customer: link.customer_name, name: link.person_name, shop: shop.name };
  }

  /** Spends the link and opens a session; returns the cookie's token. */
  async useLink(token: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const businessId = await this.repository.linkBusiness(hashRefreshToken(token));
    if (businessId === undefined) throw new NotFoundError('This link no longer works. Ask the shop for a new one, or sign in with your email.');
    enterBusiness(businessId);
    return this.transactions.run(async (repos) => {
      const used = await repos.portal.useLink(hashRefreshToken(token), now);
      if (!used) throw new NotFoundError('This link no longer works. Ask the shop for a new one, or sign in with your email.');
      const person = await repos.portal.findUser(used.portal_user_id);
      const settings = person ? await repos.portal.findSettings(person.customer_id) : undefined;
      if (!person || !settings?.portal_enabled || settings.archived_at) throw new NotFoundError('This link no longer works. Ask the shop for a new one.');
      const session = generateRefreshToken();
      const expiresAt = new Date(now.getTime() + PORTAL_SESSION_DAYS * DAY_MS);
      await repos.portal.createSession(person.id, hashRefreshToken(session), expiresAt, now);
      await repos.activityLog.create({
        userId: null,
        action: 'portal.signed_in',
        entityType: 'customer',
        entityId: person.customer_id,
        say: { key: 'portalSignedIn', params: { name: settings.name, person: person.name } },
        details: { portalUserId: person.id, how: used.purpose },
      });
      return { token: session, expiresAt };
    });
  }

  /** The person behind a cookie, or null. Read fresh every time, so switching the portal off works at once. */
  async authenticate(token: string, now = new Date()): Promise<PortalPrincipal | null> {
    const record = await this.repository.findPrincipal(hashRefreshToken(token), now);
    if (!record || !record.portal_enabled || record.archived_at) return null;
    enterBusiness(record.business_id);
    // Seen at most once a minute is enough for "last seen".
    if (!record.last_seen_at || now.getTime() - record.last_seen_at.getTime() > 60_000) await this.repository.touchSession(record.session_id, record.id, now);
    return toPrincipal(record);
  }

  async signOut(token: string, now = new Date()): Promise<void> {
    const businessId = await this.repository.sessionBusiness(hashRefreshToken(token));
    if (businessId === undefined) return;
    enterBusiness(businessId);
    await this.repository.revokeSession(hashRefreshToken(token), now);
  }

  async me(p: PortalPrincipal) {
    const [shop, unseenChanges] = await Promise.all([this.repository.shop(), this.repository.unseenChanges(p.customerId)]);
    return {
      unseenChanges,
      person: { name: p.name, email: p.email, language: p.language },
      customer: { name: p.customerName },
      canOrder: p.canOrder,
      minOrder: p.minOrder,
      shop: { name: shop.name, phone: shop.phone, address: shop.address },
    };
  }

  async setLanguage(p: PortalPrincipal, language: PortalLanguage): Promise<void> {
    await this.repository.setLanguage(p.personId, language);
  }

  // ——— Products and prices ———

  private priceOf(product: PortalProductRecord, wholesale: boolean): number {
    return roundMoney(levelPrice(Number(product.base_price), product.wholesale_price === null ? null : Number(product.wholesale_price), wholesale));
  }

  private toProductDto(product: PortalProductRecord, wholesale: boolean): PortalProductDto {
    const price = this.priceOf(product, wholesale);
    return {
      id: product.id,
      name: product.name,
      category: { id: product.category_id, name: product.category_name },
      imageUrl: product.image_url,
      unit: product.unit as ProductUnit,
      vatRate: Number(product.vat_rate),
      price,
      net: splitVat(price, Number(product.vat_rate)).net,
      inStock: Number(product.quantity_on_hand) > 0,
    };
  }

  async catalogue(p: PortalPrincipal, query: { search?: string; categoryId?: number }) {
    const [categories, products] = await Promise.all([
      this.repository.categories(p.categories),
      this.repository.products({ categories: p.categories, search: query.search, categoryId: query.categoryId }),
    ]);
    return { categories, products: products.map((product) => this.toProductDto(product, p.paysWholesale)) };
  }

  /**
   * Prices a basket at today's prices for this customer, the same way an offer
   * does: their price level, or a bulk price when the quantity reaches one and
   * it is lower. Only product ids and quantities come from the phone.
   */
  async quote(p: PortalPrincipal, asked: Array<{ productId: number; quantity: number }>): Promise<PortalQuoteDto> {
    return { ...(await this.price({ categories: p.categories, paysWholesale: p.paysWholesale }, asked)), minOrder: p.minOrder, canOrder: p.canOrder };
  }

  /** Prices lines at a customer's price level; `categories` null means any product (the shop's own changes). */
  private async price(p: { categories: number[] | null; paysWholesale: boolean }, asked: Array<{ productId: number; quantity: number }>) {
    if (asked.length > MAX_LINES) throw new ValidationError(`At most ${MAX_LINES} products in one order`);
    const ids = [...new Set(asked.map((line) => line.productId))];
    const [products, tiers] = await Promise.all([this.repository.products({ categories: p.categories, ids }), this.pricingTiers.findByProductIds(ids)]);
    const byId = new Map(products.map((product) => [product.id, product]));
    const quantities = new Map<number, number>();
    for (const line of asked) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
    const lines: PricedLine[] = [];
    const missing: number[] = [];
    for (const [productId, quantity] of quantities) {
      const product = byId.get(productId);
      if (!product) {
        missing.push(productId);
        continue;
      }
      const unit = product.unit as ProductUnit;
      if (!(quantity > 0) || (!allowsParts(unit) && !Number.isInteger(quantity))) {
        throw new ValidationError(`${product.name}: ${allowsParts(unit) ? 'type an amount above 0' : 'whole pieces only'}`);
      }
      const roundedQuantity = Math.round(quantity * 1000) / 1000;
      const unitPrice = roundMoney(Math.min(this.priceOf(product, p.paysWholesale), calculateUnitPrice(Number(product.base_price), tiers.get(product.id) ?? [], roundedQuantity)));
      const total = roundMoney(unitPrice * roundedQuantity);
      const split = splitVat(total, Number(product.vat_rate));
      lines.push({
        productId,
        name: product.name,
        unit,
        quantity: roundedQuantity,
        unitPrice,
        vatRate: Number(product.vat_rate),
        net: split.net,
        vat: split.vat,
        total,
        inStock: Number(product.quantity_on_hand) > 0,
      });
    }
    const total = roundMoney(lines.reduce((sum, line) => sum + line.total, 0));
    const net = roundMoney(lines.reduce((sum, line) => sum + line.net, 0));
    return { lines, net, vat: roundMoney(total - net), total, missing };
  }

  // ——— Orders, the customer's side ———

  async placeOrder(p: PortalPrincipal, input: { lines: Array<{ productId: number; quantity: number }>; note: string | null }): Promise<PortalOrderDetailDto> {
    if (!p.canOrder) throw new ForbiddenError('Ordering here is switched off for your account. Call the shop to order.');
    if (input.lines.length === 0) throw new ValidationError('Add at least one product');
    const quote = await this.quote(p, input.lines);
    if (quote.missing.length > 0) throw new ConflictError('Some products are no longer offered. Look at the basket again.');
    if (p.minOrder !== null && quote.total < p.minOrder) {
      throw new ValidationError(`The smallest order is ${formatMoney(p.minOrder, 'en')}`);
    }
    const id = await this.transactions.run(async (repos) => {
      const orderId = await repos.portal.createOrder({
        customerId: p.customerId,
        portalUserId: p.personId,
        note: input.note,
        net: quote.net,
        vat: quote.vat,
        total: quote.total,
        lines: quote.lines.map((line) => ({ productId: line.productId, productName: line.name, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, vatRate: line.vatRate, total: line.total, inStock: line.inStock })),
      });
      await repos.activityLog.create({
        userId: null,
        action: 'portal.order_sent',
        entityType: 'portal_order',
        entityId: orderId,
        say: { key: 'portalOrderSent', params: { name: p.customerName, person: p.name, id: orderId, total: quote.total } },
        details: { customerId: p.customerId, portalUserId: p.personId, total: quote.total, lines: quote.lines.length },
      });
      await repos.notifications.createForRoles(rolesWith('oversee'), {
        type: NOTIFICATION_TYPES.PORTAL_ORDER,
        write: (t) => ({ title: t.portalOrderTitle, message: t.portalOrderMessage({ name: p.customerName, total: quote.total, lines: quote.lines.length }) }),
        link: `/portal-orders?open=${orderId}`,
      });
      return orderId;
    });
    return this.order(p, id);
  }

  async orders(p: PortalPrincipal): Promise<PortalOrderDto[]> {
    return (await this.repository.ordersOf(p.customerId)).map(toOrderDto);
  }

  async order(p: PortalPrincipal, id: number): Promise<PortalOrderDetailDto> {
    const order = await this.repository.findOrder(id, p.customerId);
    if (!order) throw new NotFoundError(`Order ${id} does not exist`);
    if (order.status === 'changed' && order.change_seen_at === null) await this.repository.markChangeSeen(id, p.customerId, new Date());
    const lines = await this.repository.orderLines(id);
    return { ...toOrderDto(order), lines: lines.map(toLineDto), canCancel: order.status === 'sent' || order.status === 'changed', canAgree: order.status === 'changed' };
  }

  /** The customer agrees to the shop's change; the order goes back to the shop to accept. */
  async agree(p: PortalPrincipal, id: number, now = new Date()): Promise<PortalOrderDetailDto> {
    await this.transactions.run(async (repos) => {
      const order = await repos.portal.findOrder(id, p.customerId, true);
      if (!order) throw new NotFoundError(`Order ${id} does not exist`);
      if (order.status !== 'changed') throw new ConflictError('There is no change waiting on this order');
      await repos.portal.agreeChange(id, now);
      await repos.activityLog.create({
        userId: null,
        action: 'portal.change_agreed',
        entityType: 'portal_order',
        entityId: id,
        say: { key: 'portalChangeAgreed', params: { name: p.customerName, person: p.name, id } },
        details: { customerId: p.customerId, portalUserId: p.personId },
      });
      await repos.notifications.createForRoles(rolesWith('oversee'), {
        type: NOTIFICATION_TYPES.PORTAL_ORDER,
        write: (w) => ({ title: w.portalChangeAgreedTitle, message: w.portalChangeAgreedMessage({ name: p.customerName, id }) }),
        link: `/portal-orders?open=${id}`,
      });
    });
    return this.order(p, id);
  }

  /** "Order again": the old order's products at today's prices, for the basket. */
  async reorder(p: PortalPrincipal, id: number): Promise<PortalQuoteDto> {
    const order = await this.repository.findOrder(id, p.customerId);
    if (!order) throw new NotFoundError(`Order ${id} does not exist`);
    const lines = await this.repository.orderLines(id);
    return this.quote(p, lines.map((line) => ({ productId: line.product_id, quantity: line.quantity })));
  }

  async cancel(p: PortalPrincipal, id: number, now = new Date()): Promise<PortalOrderDetailDto> {
    await this.transactions.run(async (repos) => {
      const order = await repos.portal.findOrder(id, p.customerId, true);
      if (!order) throw new NotFoundError(`Order ${id} does not exist`);
      if (order.status !== 'sent' && order.status !== 'changed') throw new ConflictError('The shop has already seen this order. Call them to change it.');
      await repos.portal.decide(id, { status: 'cancelled', userId: null }, now);
      if (order.status === 'changed') {
        await repos.notifications.createForRoles(rolesWith('oversee'), {
          type: NOTIFICATION_TYPES.PORTAL_ORDER,
          write: (w) => ({ title: w.portalChangeCancelledTitle, message: w.portalChangeCancelledMessage({ name: p.customerName, id }) }),
          link: `/portal-orders?open=${id}`,
        });
      }
      await repos.activityLog.create({
        userId: null,
        action: 'portal.order_cancelled',
        entityType: 'portal_order',
        entityId: id,
        say: { key: 'portalOrderCancelled', params: { name: p.customerName, person: p.name, id } },
        details: { customerId: p.customerId, portalUserId: p.personId },
      });
    });
    return this.order(p, id);
  }

  // ——— Invoices and money ———

  async documents(p: PortalPrincipal): Promise<PortalDocumentDto[]> {
    return (await this.repository.documentsOf(p.customerId)).map((d: PortalDocumentRecord) => ({
      id: d.id,
      kind: d.kind,
      number: d.number,
      issuedAt: d.issued_at.toISOString(),
      dueDate: d.due_date,
      net: Number(d.net_total),
      vat: Number(d.vat_total),
      total: Number(d.total),
      onAccount: d.payment_method === 'account',
      corrects: d.corrects_number,
    }));
  }

  documentHtml(p: PortalPrincipal, id: number, language: PortalLanguage): Promise<string> {
    return this.documentService.htmlForCustomer(id, p.customerId, language);
  }

  async account(p: PortalPrincipal, now = new Date()): Promise<PortalAccountDto> {
    const [detail, shop] = await Promise.all([this.tabService.detail(p.customerId), this.repository.shop()]);
    const today = zonedDay(now, this.timeZone);
    return {
      balance: detail.balance,
      payLater: detail.payLater,
      creditLimit: detail.payLater ? detail.creditLimit : null,
      lateAmount: detail.lateAmount,
      lateSince: detail.lateSince,
      lastPaymentAt: detail.lastPaymentAt,
      openItems: detail.openItems.map((item) => ({
        documentId: item.documentId,
        number: item.number,
        date: item.date,
        dueDate: item.dueDate,
        total: item.total,
        paid: item.paid,
        left: item.left,
        late: item.dueDate !== null && item.dueDate < today && item.left > 0,
      })),
      shop: { name: shop.name, bankName: shop.bank_name, iban: shop.iban },
    };
  }

  /** Everything charged and paid in a period, with the balance before and after: for their accountant. */
  async statement(p: PortalPrincipal, from: string, to: string): Promise<PortalStatementDto> {
    if (from > to) throw new ValidationError('The first day must come before the last');
    const [entries, invoices, shop] = await Promise.all([this.tabRepository.findEntries([p.customerId]), this.tabRepository.chargeInvoices([p.customerId]), this.repository.shop()]);
    let balance = 0;
    let opening = 0;
    const lines: PortalStatementDto['lines'] = [];
    for (const entry of entries) {
      if (entry.sale_undone) continue;
      const day = zonedDay(entry.occurred_at, this.timeZone);
      if (day > to) break;
      const amount = Number(entry.amount);
      const signed = entry.kind === 'charge' ? amount : -amount;
      balance = roundMoney(balance + signed);
      if (day < from) {
        opening = balance;
        continue;
      }
      lines.push({
        date: day,
        kind: entry.kind,
        number: entry.kind === 'charge' && entry.sale_id !== null ? (invoices.get(entry.sale_id)?.number ?? null) : null,
        debit: signed > 0 ? amount : 0,
        credit: signed < 0 ? amount : 0,
        balance,
      });
    }
    return { from, to, opening, closing: balance, lines, customer: { name: p.customerName }, shop: { name: shop.name } };
  }

  // ——— The shop's side ———

  async settings(customerId: number, now = new Date()): Promise<ShopPortalDto> {
    const settings = await this.repository.findSettings(customerId);
    if (!settings) throw new NotFoundError(`Customer ${customerId} does not exist`);
    const [people, pending, allCategories] = await Promise.all([this.repository.listUsers(customerId), this.repository.pendingInvites(customerId, now), this.repository.allCategories()]);
    return {
      customerId,
      enabled: settings.portal_enabled,
      canOrder: settings.portal_can_order,
      minOrder: money(settings.portal_min_order),
      categories: settings.portal_categories,
      people: people.map((person) => ({
        id: person.id,
        name: person.name,
        email: person.email,
        phone: person.phone,
        language: person.language,
        lastSeenAt: person.last_seen_at?.toISOString() ?? null,
        invitePending: pending.has(person.id),
      })),
      allCategories,
    };
  }

  async saveSettings(customerId: number, input: PortalSettingsInput, actorId: number, now = new Date()): Promise<ShopPortalDto> {
    await this.transactions.run(async (repos) => {
      const before = await repos.portal.findSettings(customerId);
      if (!before) throw new NotFoundError(`Customer ${customerId} does not exist`);
      if (before.archived_at) throw new ConflictError('This customer is closed. Open them again first.');
      let categories = input.categories;
      if (categories) {
        categories = [...new Set(categories)];
        const known = await repos.portal.existingCategories(categories);
        if (known.length !== categories.length) throw new ValidationError('One of the categories no longer exists');
      }
      await repos.portal.saveSettings(customerId, { ...input, categories });
      // Off means off: everyone signed in is signed out.
      if (before.portal_enabled && !input.enabled) await repos.portal.revokeCustomerSessions(customerId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'portal.settings_changed',
        entityType: 'customer',
        entityId: customerId,
        say: { key: 'portalSettings', params: { name: before.name, on: input.enabled } },
        details: {
          from: { enabled: before.portal_enabled, canOrder: before.portal_can_order, minOrder: money(before.portal_min_order), categories: before.portal_categories },
          to: { enabled: input.enabled, canOrder: input.canOrder, minOrder: input.minOrder, categories },
        },
      });
    });
    return this.settings(customerId, now);
  }

  /** Adds a person and makes their one-time link; the owner sends it by WhatsApp, or 4VD emails it. */
  async invite(customerId: number, input: PortalInviteInput, actorId: number, now = new Date()): Promise<{ person: ShopPortalPersonDto; link: string; emailed: boolean }> {
    const email = input.email?.trim().toLowerCase() || null;
    const result = await this.transactions.run(async (repos) => {
      const settings = await repos.portal.findSettings(customerId);
      if (!settings) throw new NotFoundError(`Customer ${customerId} does not exist`);
      if (!settings.portal_enabled || settings.archived_at) throw new ConflictError('Switch the portal on for this customer first');
      if (email && (await repos.portal.emailTaken(email))) throw new ConflictError('This email already signs in to the portal');
      const personId = await repos.portal.createUser({ customerId, name: input.name.trim(), email, phone: input.phone?.trim() || null, language: input.language, createdBy: actorId });
      const token = generateRefreshToken();
      await repos.portal.createLink(personId, 'invite', hashRefreshToken(token), new Date(now.getTime() + PORTAL_INVITE_DAYS * DAY_MS));
      await repos.activityLog.create({
        userId: actorId,
        action: 'portal.invited',
        entityType: 'customer',
        entityId: customerId,
        say: { key: 'portalInvited', params: { name: settings.name, person: input.name.trim() } },
        details: { portalUserId: personId, email, byEmail: Boolean(email && input.sendEmail) },
      });
      return { personId, token, customerName: settings.name };
    });
    const emailed = await this.sendInvite(email, input.sendEmail, input.language, result.customerName, result.token);
    const person = (await this.settings(customerId, now)).people.find((one) => one.id === result.personId)!;
    return { person, link: this.link(result.token, 'invite'), emailed };
  }

  /** A fresh invite link for someone already added (the old one stops working). */
  async reinvite(personId: number, input: { sendEmail: boolean }, actorId: number, now = new Date()): Promise<{ link: string; emailed: boolean }> {
    const person = await this.repository.findUser(personId);
    if (!person) throw new NotFoundError(`Person ${personId} does not exist`);
    const settings = await this.repository.findSettings(person.customer_id);
    if (!settings?.portal_enabled || settings.archived_at) throw new ConflictError('Switch the portal on for this customer first');
    const token = generateRefreshToken();
    await this.transactions.run(async (repos) => {
      await repos.portal.createLink(person.id, 'invite', hashRefreshToken(token), new Date(now.getTime() + PORTAL_INVITE_DAYS * DAY_MS));
      await repos.activityLog.create({
        userId: actorId,
        action: 'portal.invited',
        entityType: 'customer',
        entityId: person.customer_id,
        say: { key: 'portalInvited', params: { name: settings.name, person: person.name } },
        details: { portalUserId: person.id, again: true, byEmail: Boolean(person.email && input.sendEmail) },
      });
    });
    const emailed = await this.sendInvite(person.email, input.sendEmail, person.language, settings.name, token);
    return { link: this.link(token, 'invite'), emailed };
  }

  private async sendInvite(email: string | null, send: boolean, language: PortalLanguage, customerName: string, token: string): Promise<boolean> {
    if (!email || !send) return false;
    const shop = await this.repository.shop();
    await this.emailService.queue(email, emailTemplates.portalInvite({ shopName: shop.name, customerName, link: this.link(token, 'invite') }, messages[language]));
    return true;
  }

  async removePerson(personId: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      const person = await repos.portal.findUser(personId);
      if (!person) throw new NotFoundError(`Person ${personId} does not exist`);
      const settings = await repos.portal.findSettings(person.customer_id);
      await repos.portal.removeUser(personId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'portal.person_removed',
        entityType: 'customer',
        entityId: person.customer_id,
        say: { key: 'portalPersonRemoved', params: { name: settings?.name ?? '', person: person.name } },
        details: { portalUserId: personId },
      });
    });
  }

  async signOutEverywhere(customerId: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      const settings = await repos.portal.findSettings(customerId);
      if (!settings) throw new NotFoundError(`Customer ${customerId} does not exist`);
      await repos.portal.revokeCustomerSessions(customerId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'portal.signed_out_everywhere',
        entityType: 'customer',
        entityId: customerId,
        say: { key: 'portalSignedOutEverywhere', params: { name: settings.name } },
      });
    });
  }

  private toShopOrder(o: PortalOrderRecord): ShopPortalOrderDto {
    return { ...toOrderDto(o), status: o.status, customer: { id: o.customer_id, name: o.customer_name }, offerId: o.offer_id };
  }

  async shopOrders(filter: { customerId?: number }): Promise<ShopPortalOrderDto[]> {
    const rows = filter.customerId ? await this.repository.ordersOf(filter.customerId) : await this.repository.recentOrders();
    return rows.map((row) => this.toShopOrder(row));
  }

  openOrders(): Promise<PortalOrderRecord[]> {
    return this.repository.openOrders();
  }

  /** Opening an order marks it seen, which the customer sees. */
  async shopOrder(id: number, actorId: number, now = new Date()): Promise<ShopPortalOrderDto & { lines: PortalOrderDetailDto['lines'] }> {
    const order = await this.repository.findOrder(id, null);
    if (!order) throw new NotFoundError(`Order ${id} does not exist`);
    if (order.status === 'sent') await this.repository.markSeen(id, actorId, now);
    const fresh = (await this.repository.findOrder(id, null))!;
    return { ...this.toShopOrder(fresh), lines: (await this.repository.orderLines(id)).map(toLineDto) };
  }

  /**
   * Turns the order into an offer at the prices the customer saw. From there
   * the usual way applies: sell it at the Counter, deliver it, pay later.
   */
  async accept(id: number, actorId: number, now = new Date()) {
    const order = await this.transactions.run(async (repos) => {
      const row = await repos.portal.findOrder(id, null, true);
      if (!row) throw new NotFoundError(`Order ${id} does not exist`);
      if (row.status === 'changed') throw new ConflictError('The customer hasn’t agreed to your change yet');
      if (row.status !== 'sent' && row.status !== 'seen') throw new ConflictError('This order was already answered');
      await repos.portal.decide(id, { status: 'accepted', userId: actorId }, now);
      return row;
    });
    try {
      const lines = await this.repository.orderLines(id);
      const offer = await this.salesDocumentService.createOffer(
        {
          customerId: order.customer_id,
          partyName: null,
          partyPhone: null,
          note: order.note,
          validUntil: null,
          lines: lines.map((line) => ({ productId: line.product_id, quantity: line.quantity, unitPrice: Number(line.unit_price) })),
        },
        actorId,
        now,
      );
      await this.transactions.run(async (repos) => {
        await repos.portal.decide(id, { status: 'accepted', userId: actorId, offerId: offer.id }, now);
        await repos.activityLog.create({
          userId: actorId,
          action: 'portal.order_accepted',
          entityType: 'portal_order',
          entityId: id,
          say: { key: 'portalOrderAccepted', params: { name: order.customer_name, id, offer: offer.number } },
          details: { customerId: order.customer_id, offerId: offer.id },
        });
      });
      return { order: await this.shopOrder(id, actorId, now), offer: { id: offer.id, number: offer.number } };
    } catch (error) {
      // The offer couldn't be made (a product was removed since): put the order back so it can be answered again.
      await this.repository.reopen(id, order.status === 'sent' ? 'sent' : 'seen');
      throw error;
    }
  }

  async decline(id: number, reason: string | null, actorId: number, now = new Date()) {
    await this.transactions.run(async (repos) => {
      const row = await repos.portal.findOrder(id, null, true);
      if (!row) throw new NotFoundError(`Order ${id} does not exist`);
      if (row.status !== 'sent' && row.status !== 'seen' && row.status !== 'changed') throw new ConflictError('This order was already answered');
      await repos.portal.decide(id, { status: 'declined', userId: actorId, reason }, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'portal.order_declined',
        entityType: 'portal_order',
        entityId: id,
        say: { key: 'portalOrderDeclined', params: { name: row.customer_name, id } },
        details: { customerId: row.customer_id, reason },
      });
    });
    return this.shopOrder(id, actorId, now);
  }

  /**
   * The shop changes an order before accepting it: other quantities, lines
   * taken out or added, always at this customer's own prices. A reason is
   * required; the order then waits for the customer to agree or cancel, and
   * everyone at the firm with an email is told.
   */
  async change(id: number, input: { lines: Array<{ productId: number; quantity: number }>; reason: string }, actorId: number, now = new Date()) {
    const reason = input.reason.trim();
    if (!reason) throw new ValidationError('Say why the order changed');
    if (input.lines.length === 0) throw new ValidationError('Keep at least one product, or decline the order');
    const current = await this.repository.findOrder(id, null);
    if (!current) throw new NotFoundError(`Order ${id} does not exist`);
    const settings = await this.repository.findSettings(current.customer_id);
    const priced = await this.price({ categories: null, paysWholesale: settings?.pays_wholesale ?? false }, input.lines);
    if (priced.missing.length > 0) throw new ConflictError('Some products are no longer on sale');
    const order = await this.transactions.run(async (repos) => {
      const row = await repos.portal.findOrder(id, null, true);
      if (!row) throw new NotFoundError(`Order ${id} does not exist`);
      if (row.status !== 'sent' && row.status !== 'seen' && row.status !== 'changed') throw new ConflictError('This order was already answered');
      // What the customer agreed to; kept as it was while an earlier change is still unanswered.
      let previous: PortalOrderSnapshot | null = null;
      if (row.status !== 'changed') {
        const before = await repos.portal.orderLines(id);
        previous = {
          net: Number(row.net),
          vat: Number(row.vat),
          total: Number(row.total),
          lines: before.map((line) => ({ productId: line.product_id, name: line.product_name, unit: line.unit, quantity: line.quantity, unitPrice: Number(line.unit_price), total: Number(line.total) })),
        };
      }
      await repos.portal.replaceLines(
        id,
        {
          net: priced.net,
          vat: priced.vat,
          total: priced.total,
          lines: priced.lines.map((line) => ({ productId: line.productId, productName: line.name, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, vatRate: line.vatRate, total: line.total, inStock: line.inStock })),
          reason,
          userId: actorId,
          previous,
        },
        now,
      );
      await repos.activityLog.create({
        userId: actorId,
        action: 'portal.order_changed',
        entityType: 'portal_order',
        entityId: id,
        say: { key: 'portalOrderChanged', params: { name: row.customer_name, id, reason } },
        details: { customerId: row.customer_id, reason, total: priced.total, lines: priced.lines.length },
      });
      return row;
    });
    const [people, shop] = await Promise.all([this.repository.listUsers(order.customer_id), this.repository.shop()]);
    const link = `${this.dashboardUrl}/portal/orders/${id}`;
    for (const person of people) {
      if (!person.email) continue;
      await this.emailService.queue(
        person.email,
        emailTemplates.portalOrderChanged({ shopName: shop.name, orderId: id, reason, total: formatMoney(priced.total, person.language), link }, messages[person.language]),
      );
    }
    return this.shopOrder(id, actorId, now);
  }
}
