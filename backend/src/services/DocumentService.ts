import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { DocumentKind, DocumentParty, DocumentPaymentMethod } from '../database/types.js';
import type { Language } from '../i18n/language.js';
import type { DocumentLineRecord, DocumentRecord, DocumentRepository, NewDocumentLine } from '../repositories/DocumentRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import type { PublicUser } from '../types/auth.js';
import { roundMoney } from '../utils/money.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { canReadBooks } from '../utils/roles.js';
import { zonedDay } from '../utils/zonedDates.js';
import { assertMonthsOpen } from './vat/periodLock.js';
import { renderDocumentHtml } from './documents/documentHtml.js';
import { splitVat } from './documents/vat.js';
import { toMoney, toMoneyOrNull } from './mappers.js';
import type { SettingsService } from './SettingsService.js';

export interface DocumentLineDto {
  saleId: number;
  returnId: number | null;
  productName: string;
  /** The product's barcode, else its SKU, as it was when issued. */
  productCode: string | null;
  quantity: number;
  /** VAT-inclusive, after any rabat. */
  unitPrice: number;
  /** Rabat given at the counter, in percent; null when none. */
  discountPercent: number | null;
  /** The unit price before that rabat. */
  priceBeforeDiscount: number | null;
  vatRate: number;
  /** Exempt from VAT (its rate is 0). */
  vatExempt: boolean;
  netAmount: number;
  vatAmount: number;
  total: number;
}

export interface DocumentDto {
  id: number;
  kind: DocumentKind;
  number: string;
  issuedAt: string;
  issuedBy: string | null;
  seller: DocumentParty;
  buyer: DocumentParty | null;
  /** The customer record the buyer came from, when there is one. */
  customerId: number | null;
  /** The invoice a credit note reverses. */
  corrects: { id: number; number: string } | null;
  reason: string | null;
  netTotal: number;
  vatTotal: number;
  total: number;
  fiscalReceiptNo: string | null;
  /** Paid at the till, or on the customer's account (their tab). */
  paymentMethod: DocumentPaymentMethod;
  /** Split payment: the part of a till invoice paid by card; the rest was cash. */
  cardAmount: number | null;
  /** "YYYY-MM-DD": when an invoice on account is due. */
  dueDate: string | null;
  /** An invoice TREFIN issued: history to look at, never changed here. */
  fromTrefin: boolean;
}

export interface DocumentDetailDto extends DocumentDto {
  lines: DocumentLineDto[];
  /** VAT per rate, highest rate first; only rates the document uses. */
  vatByRate: Array<{ rate: number; net: number; vat: number }>;
}

/** Just enough to point at a document from a sale or a checkout. */
export interface DocumentRef {
  id: number;
  number: string;
}

export interface DocumentQuery extends PageRequest {
  kind?: DocumentKind;
  search?: string;
  customerId?: number;
  startDate?: Date;
  endDate?: Date;
  source?: 'trefin' | '4vd';
}

/** A follow-up document for part or all of one invoiced sale. */
export interface FollowUp {
  saleId: number;
  returnId: number | null;
  quantity: number;
  /** VAT-inclusive amount for these units. */
  total: number;
  /** What the person wrote, if anything; the document already says what it reverses. */
  reason: string | null;
  issuedBy: number;
}

const PREFIX: Record<DocumentKind, string> = { invoice: 'F', credit_note: 'K' };
/**
 * Sales documents. Issuing happens inside the caller's transaction (a checkout,
 * an undo, a return), so a sale and its document are saved together or not at
 * all. Issued documents never change; mistakes are reversed by a credit note.
 */
export class DocumentService {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
    private readonly settings: SettingsService,
  ) {}

  /** The invoice for a checkout: one line per sale. */
  async invoiceSales(
    repos: TransactionalRepositories,
    p: { saleIds: number[]; customerId: number | null; onAccount: boolean; issuedBy: number; byCard?: boolean; cardAmount?: number; clientKey?: string },
  ): Promise<DocumentRef> {
    const sales = await repos.documents.salesForDocument(p.saleIds);
    const lines = sales.map((sale) => {
      const unitPrice = toMoney(sale.price_per_unit);
      return lineFor({ saleId: sale.id, returnId: null, productName: sale.product_name,
        productCode: sale.product_code,
        quantity: sale.quantity_sold,
        unitPrice,
        discountPercent: toMoneyOrNull(sale.discount_percent),
        priceBeforeDiscount: toMoneyOrNull(sale.price_before_discount),
        vatRate: sale.vat_rate,
        vatExempt: sale.vat_exempt,
      });
    });
    const buyer = p.customerId === null ? null : ((await repos.documents.customerParty(p.customerId)) ?? null);
    const paymentMethod = p.customerId !== null && p.onAccount ? 'account' : p.byCard ? 'card' : 'till';
    const cardAmount = paymentMethod === 'till' && p.cardAmount ? roundMoney(p.cardAmount) : null;
    // Split payment: the card pays part, cash the rest. A card paying it all is a card sale.
    if (cardAmount !== null && cardAmount >= roundMoney(lines.reduce((sum, line) => sum + line.total, 0))) {
      throw new ValidationError('The card part must be less than the total; for all of it, pay by card');
    }
    return this.issue(repos, { kind: 'invoice', lines, customerId: p.customerId, buyer, correctsId: null, reason: null, issuedBy: p.issuedBy, paymentMethod, cardAmount, clientKey: p.clientKey ?? null });
  }

  /**
   * A credit note (reversing) or a new invoice (charging again) for units of a
   * sale that was invoiced before, at that invoice's VAT rate and for its buyer.
   * Null when the sale is older than documents and so was never invoiced.
   */
  async followUp(repos: TransactionalRepositories, kind: DocumentKind, p: FollowUp): Promise<DocumentRef | null> {
    const invoiced = await repos.documents.lastInvoiceLineOf(p.saleId);
    if (!invoiced) return null;
    const line = lineFor({
      saleId: p.saleId,
      returnId: p.returnId,
      productName: invoiced.product_name,
      productCode: invoiced.product_code,
      discountPercent: toMoneyOrNull(invoiced.discount_percent),
      priceBeforeDiscount: toMoneyOrNull(invoiced.price_before_discount),
      quantity: p.quantity,
      unitPrice: roundMoney(p.total / p.quantity),
      vatRate: invoiced.vat_rate,
      vatExempt: invoiced.vat_exempt,
      total: p.total,
    });
    return this.issue(repos, {
      kind,
      lines: [line],
      customerId: invoiced.customer_id,
      buyer: invoiced.buyer,
      correctsId: kind === 'credit_note' ? invoiced.document_id : null,
      reason: p.reason,
      issuedBy: p.issuedBy,
      paymentMethod: invoiced.payment_method,
    });
  }

  private async issue(
    repos: TransactionalRepositories,
    p: {
      kind: DocumentKind;
      lines: NewDocumentLine[];
      customerId: number | null;
      buyer: DocumentParty | null;
      correctsId: number | null;
      reason: string | null;
      issuedBy: number;
      paymentMethod: DocumentPaymentMethod;
      cardAmount?: number | null;
      clientKey?: string | null;
    },
  ): Promise<DocumentRef> {
    const today = zonedDay(new Date(), this.timeZone);
    const year = Number(today.slice(0, 4));
    // An invoice on account is due after the shop's payment terms; anything paid at the till is settled already.
    const dueDate =
      p.kind === 'invoice' && p.paymentMethod === 'account' ? addDays(today, (await this.settings.get()).paymentTermsDays) : null;
    const sequence = await repos.documents.nextNumber(p.kind, year);
    const number = `${PREFIX[p.kind]}-${year}-${String(sequence).padStart(6, '0')}`;
    const sum = (pick: (line: NewDocumentLine) => number) => roundMoney(p.lines.reduce((total, line) => total + pick(line), 0));
    const id = await repos.documents.create({
      ...p,
      number,
      seller: await repos.documents.seller(),
      netTotal: sum((line) => line.netAmount),
      vatTotal: sum((line) => line.vatAmount),
      total: sum((line) => line.total),
      dueDate,
    });
    await repos.activityLog.create({
      userId: p.issuedBy,
      action: 'document.issued',
      entityType: 'document',
      entityId: id,
      say: { key: 'documentIssued', params: { kind: p.kind, number, total: sum((line) => line.total) } },
      details: { kind: p.kind, number, total: sum((line) => line.total), correctsId: p.correctsId, reason: p.reason },
    });
    return { id, number };
  }

  async list(query: DocumentQuery) {
    const { documents, total, sums } = await this.documentRepository.findMany({
      kind: query.kind,
      search: query.search,
      customerId: query.customerId,
      startDate: query.startDate,
      endDate: query.endDate,
      source: query.source,
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: documents.map(toDto), meta: { ...toPaginationMeta(query, total), totals: sums } };
  }

  async get(id: number, viewer: PublicUser): Promise<DocumentDetailDto> {
    const record = await this.visible(id, viewer);
    const lines = (await this.documentRepository.findLines(id)).map(toLineDto);
    return { ...toDto(record), lines, vatByRate: vatByRate(lines) };
  }

  /** The A4 page, ready for a browser or the phone to print or save as PDF. */
  async html(id: number, viewer: PublicUser, language: Language): Promise<string> {
    const [document, letterhead] = await Promise.all([this.get(id, viewer), this.documentRepository.letterhead()]);
    return renderDocumentHtml(document, letterhead, language, this.timeZone);
  }

  /** Link the document to the receipt the fiscal printer gave. The only change an issued document allows. */
  async setFiscalReceipt(id: number, value: string | null, viewer: PublicUser): Promise<DocumentDetailDto> {
    const record = await this.visible(id, viewer);
    if (record.trefin_ref) throw new ConflictError("This invoice is TREFIN's history. It can be looked at, not changed.");
    await this.transactions.run(async (repos) => {
      await assertMonthsOpen(repos.periods, [zonedDay(record.issued_at, this.timeZone)]);
      await repos.documents.setFiscalReceipt(id, value);
      await repos.activityLog.create({
        userId: viewer.id,
        action: 'document.fiscal_receipt',
        entityType: 'document',
        entityId: id,
        say: value ? { key: 'fiscalReceiptLinked', params: { number: record.number, receipt: value } } : { key: 'fiscalReceiptRemoved', params: { number: record.number } },
        details: { from: record.fiscal_receipt_no, to: value },
      });
    });
    return this.get(id, viewer);
  }

  /** Employees see the documents they issued; the people who run the shop, and the accountant, see all. */
  private async visible(id: number, viewer: PublicUser): Promise<DocumentRecord> {
    const record = await this.documentRepository.findById(id);
    if (!record) throw new NotFoundError(`Document ${id} does not exist`);
    if (!canReadBooks(viewer.role) && record.issued_by !== viewer.id) {
      throw new ForbiddenError('You can only open the documents you issued');
    }
    return record;
  }
}

function lineFor(p: {
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
  total?: number;
}): NewDocumentLine {
  const total = p.total ?? roundMoney(p.unitPrice * p.quantity);
  const { net, vat } = splitVat(total, p.vatRate);
  return { ...p, total, netAmount: net, vatAmount: vat };
}

function vatByRate(lines: DocumentLineDto[]): DocumentDetailDto['vatByRate'] {
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const line of lines) {
    const entry = byRate.get(line.vatRate) ?? { net: 0, vat: 0 };
    byRate.set(line.vatRate, { net: roundMoney(entry.net + line.netAmount), vat: roundMoney(entry.vat + line.vatAmount) });
  }
  return [...byRate].sort(([a], [b]) => b - a).map(([rate, sums]) => ({ rate, ...sums }));
}

function toDto(record: DocumentRecord): DocumentDto {
  return {
    id: record.id,
    kind: record.kind,
    number: record.number,
    issuedAt: record.issued_at.toISOString(),
    issuedBy: record.issued_by_name,
    seller: record.seller,
    buyer: record.buyer,
    customerId: record.customer_id,
    corrects: record.corrects_id === null ? null : { id: record.corrects_id, number: record.corrects_number! },
    reason: record.reason,
    netTotal: toMoney(record.net_total),
    vatTotal: toMoney(record.vat_total),
    total: toMoney(record.total),
    fiscalReceiptNo: record.fiscal_receipt_no,
    paymentMethod: record.payment_method,
    cardAmount: toMoneyOrNull(record.card_amount),
    dueDate: record.due_date,
    fromTrefin: record.trefin_ref !== null,
  };
}

function toLineDto(line: DocumentLineRecord): DocumentLineDto {
  return {
    saleId: line.sale_id,
    returnId: line.return_id,
    productName: line.product_name,
    productCode: line.product_code,
    quantity: line.quantity,
    unitPrice: toMoney(line.unit_price),
    discountPercent: toMoneyOrNull(line.discount_percent),
    priceBeforeDiscount: toMoneyOrNull(line.price_before_discount),
    vatRate: line.vat_rate,
    vatExempt: line.vat_exempt,
    netAmount: toMoney(line.net_amount),
    vatAmount: toMoney(line.vat_amount),
    total: toMoney(line.total),
  };
}

/** "2026-10-11" plus some days, as a day again. */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
