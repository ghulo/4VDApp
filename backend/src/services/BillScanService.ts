import { DEFAULT_REORDER_LEVEL, SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { AiUnavailableError, ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { BillScanRecord, BillScanRepository } from '../repositories/BillScanRepository.js';
import type { ProductRepository } from '../repositories/ProductRepository.js';
import type { PurchaseOrderRepository } from '../repositories/PurchaseOrderRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { countryFromBarcode } from '../utils/barcodeCountry.js';
import { checkTotals, type KnownCode, type LineMatch, matchLine, nameSimilarity } from '../utils/billMatching.js';
import { roundMoney } from '../utils/money.js';
import { canOversee } from '../utils/roles.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { PublicUser } from '../types/auth.js';
import { closePendingAlerts, notifyAdminsOfPending } from './approvals/approvalHelpers.js';
import { type BillPage, type BillReader, type BillReading, billReadingSchema } from './ai/billReader.js';
import { mediaUrl } from './mappers.js';
import { applyStockChange } from './InventoryService.js';
import type { MediaService } from './MediaService.js';
import { addProductBarcode, setProductBarcode } from './ProductService.js';
import { changeCost, type OrderDto, type PurchaseOrderService, receiveOrder } from './PurchaseOrderService.js';
import { type BillInput, createBill, type SupplierBillService } from './SupplierBillService.js';

/** Enough for a long bill; more pages is usually the wrong file. */
export const MAX_SCAN_PAGES = 6;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;

export interface UploadedPage {
  mime: string;
  /** Base64, as the browser or phone read the file. */
  data: string;
}

/** What the person who scanned sees: enough to know it was read, nothing about costs. */
export interface ScanReceiptDto {
  id: number;
  supplierName: string | null;
  number: string | null;
  lines: number;
}

export interface ScanLineDto {
  read: BillReading['lines'][number];
  match: LineMatch;
}

export interface BillScanDto {
  id: number;
  status: 'waiting' | 'confirmed' | 'discarded';
  scannedBy: string | null;
  scannedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  pages: Array<{ url: string; isPdf: boolean }>;
  reading: BillReading;
  /** The supplier the lines are matched for: the one asked for, else the one recognised from the bill. */
  supplier: { id: number; name: string; matchedBy: 'nui' | 'name' | 'chosen' } | null;
  openOrders: OrderDto[];
  lines: ScanLineDto[];
  /** Every product, for linking a line by hand. */
  products: Array<{ id: number; name: string }>;
  totals: ReturnType<typeof checkTotals>;
  /** A bill from this supplier with the same number is already saved. */
  duplicateBillId: number | null;
  billId: number | null;
  orderId: number | null;
  /** The choices from the last confirm, when the scan was reopened: the check page starts from them. */
  previous: ConfirmScanInput | null;
}

/** Why a bill can't be confirmed on the phone. */
export type QuickBlocker = 'decided' | 'supplier' | 'duplicate' | 'totals' | 'no_lines' | 'new_product' | 'unsure' | 'amount';

/** A scanned bill as the phone shows it, with the confirm it would send when nothing blocks it. */
export interface QuickCheckDto {
  id: number;
  supplierName: string | null;
  number: string | null;
  amount: number | null;
  scannedBy: string | null;
  scannedAt: string;
  pages: Array<{ url: string; isPdf: boolean }>;
  lines: Array<{ name: string; product: string | null; pieces: number; unitCost: number | null; oldCost: number | null; stamp: LineMatch['stamp'] }>;
  blockers: QuickBlocker[];
  input: ConfirmScanInput | null;
}

/** A waiting scan as the To do list and the Bills page list it. */
export interface WaitingScanDto {
  id: number;
  supplierName: string | null;
  number: string | null;
  amount: number | null;
  scannedBy: string | null;
  scannedAt: string;
}

export interface ConfirmScanInput {
  supplierId: number;
  /** An open order from this supplier that this delivery fills; null makes a new one. */
  orderId: number | null;
  bill: BillInput;
  /** Where new products go. */
  categoryId: number | null;
  lines: Array<{
    readIndex?: number;
    productId: number | null;
    /** Set when the line is a product 4VD doesn't have yet. */
    newProduct: { name: string; barcode: string | null; price: number; vatRate: number } | null;
    /** The supplier's code for it, remembered for next time. */
    code: string | null;
    pieces: number;
    unitsPerPack: number;
    unitCost: number | null;
    updateCost: boolean;
    /** The barcode printed on the bill, put on the product when `updateBarcode`. */
    barcode: string | null;
    updateBarcode: boolean;
  }>;
}

/** What a confirm changed, kept on the scan so a reopen can put it all back. */
export interface ScanConfirmation {
  input: ConfirmScanInput;
  createdProducts: number[];
  costs: Array<{ productId: number; from: number | null; to: number }>;
  /** Barcodes taken from the bill: `added` when it became another barcode, else it replaced `from` (or the product had none). */
  barcodes: Array<{ productId: number; from: string | null; to: string; added?: boolean }>;
  /** Supplier codes as they were before (null: the code was new). */
  codes: Array<{ code: string; before: { productId: number; unitsPerPack: number } | null }>;
  /** The order filled: made for this bill, or an open one with its lines as they were and the lines added. */
  order: { id: number; created: boolean; lines: Array<{ id: number; unitCost: number | null }>; addedLineIds: number[] };
  received: Array<{ productId: number; pieces: number }>;
}

/**
 * Supplier bills read from a photo or PDF. Anyone at the counter can scan one;
 * it then waits until someone who runs the shop checks the lines and
 * confirms, which adds new products, receives the delivery (into an open
 * order when there is one), saves the bill with its picture, and remembers
 * the supplier's codes so their next bill matches by itself.
 */
export class BillScanService {
  constructor(
    private readonly scanRepository: BillScanRepository,
    private readonly productRepository: ProductRepository,
    private readonly orderRepository: PurchaseOrderRepository,
    private readonly orderService: PurchaseOrderService,
    private readonly billService: SupplierBillService,
    private readonly mediaService: MediaService,
    private readonly transactions: TransactionManager,
    private readonly reader: BillReader | null,
    private readonly timeZone: string,
  ) {}

  async scan(pages: UploadedPage[], actor: PublicUser): Promise<ScanReceiptDto> {
    const actorId = actor.id;
    if (!this.reader) throw new AiUnavailableError('Reading bills needs ANTHROPIC_API_KEY in the server settings. Add the bill by hand for now.');
    if (pages.length === 0 || pages.length > MAX_SCAN_PAGES) throw new ValidationError(`Send between 1 and ${MAX_SCAN_PAGES} pages`);

    const mediaIds: string[] = [];
    try {
      const read: BillPage[] = [];
      for (const page of pages) {
        const bytes = Buffer.from(page.data, 'base64');
        if (bytes.length === 0 || bytes.length > MAX_PAGE_BYTES) throw new ValidationError('Each page must be under 10 MB');
        // Photos are shrunk like any bill photo (still sharp enough for small print); PDFs are kept whole.
        const id = page.mime === 'application/pdf' ? await this.mediaService.storePdf(null, bytes) : await this.mediaService.store(null, bytes, 'bill');
        mediaIds.push(id);
        const stored = await this.mediaService.read(id);
        read.push({ mime: stored.mime, bytes: stored.bytes });
      }
      const reading = await this.reader.read(read);
      const id = await this.transactions.run(async (repos) => {
        const scanId = await repos.billScans.create({ mediaIds, reading, scannedBy: actorId });
        await repos.activityLog.create({
          userId: actorId,
          action: 'bill.scanned',
          entityType: 'bill_scan',
          entityId: scanId,
          say: { key: 'billScanned', params: { supplier: reading.supplier.name, lines: reading.lines.length } },
        });
        // Someone who runs the shop scanned it themselves and is checking it now; anyone else's waits for them.
        if (!canOversee(actor.role)) {
          await notifyAdminsOfPending(repos, 'bill', { type: 'bill_scan', id: scanId }, (t) =>
            t.billPending({ name: actor.name, supplier: reading.supplier.name, lines: reading.lines.length }),
          );
        }
        return scanId;
      });
      return { id, supplierName: reading.supplier.name, number: reading.number, lines: reading.lines.length };
    } catch (error) {
      // Nothing was saved, so the pictures go too.
      for (const id of mediaIds) await this.mediaService.remove(id);
      throw error;
    }
  }

  async waiting(): Promise<WaitingScanDto[]> {
    return (await this.scanRepository.findWaiting()).map((scan) => {
      const reading = parseReading(scan);
      return {
        id: scan.id,
        supplierName: reading.supplier.name,
        number: reading.number,
        amount: reading.totals.gross,
        scannedBy: scan.scanned_by_name,
        scannedAt: scan.scanned_at.toISOString(),
      };
    });
  }

  /** The scan with every line matched against the products, for `supplierId` when given. */
  async get(id: number, supplierId?: number): Promise<BillScanDto> {
    const scan = await this.scanRepository.findById(id);
    if (!scan) throw new NotFoundError(`Scan ${id} does not exist`);
    const reading = parseReading(scan);
    const supplier = await this.findSupplier(reading, supplierId);

    const [products, codes, orders, bills, mimes] = await Promise.all([
      this.productRepository.findAllForMatching(),
      supplier ? this.scanRepository.codesFor(supplier.id) : Promise.resolve([]),
      supplier ? this.orderService.list() : Promise.resolve([]),
      supplier && reading.number ? this.billService.list({ supplierId: supplier.id }) : Promise.resolve([]),
      this.mediaService.mimes(scan.media_ids),
    ]);
    const known = new Map<string, KnownCode>(codes.map((row) => [row.code, { productId: row.product_id, unitsPerPack: row.units_per_pack }]));
    const matchable = products.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      otherBarcodes: row.other_barcodes,
      costPrice: row.cost_price === null ? null : Number(row.cost_price),
      vatRate: row.vat_rate,
    }));
    const number = reading.number?.trim().toLowerCase();
    const duplicate = bills.find((bill) => bill.status !== 'void' && bill.number?.trim().toLowerCase() === number && bill.id !== scan.bill_id);

    return {
      id: scan.id,
      status: scan.status,
      scannedBy: scan.scanned_by_name,
      scannedAt: scan.scanned_at.toISOString(),
      decidedBy: scan.decided_by_name,
      decidedAt: scan.decided_at?.toISOString() ?? null,
      pages: scan.media_ids.map((mediaId) => ({ url: mediaUrl(mediaId)!, isPdf: mimes.get(mediaId) === 'application/pdf' })),
      reading,
      supplier,
      openOrders: orders.filter((order) => order.status === 'open' && order.supplier.id === supplier?.id),
      lines: reading.lines.map((line) => ({ read: line, match: matchLine(line, reading, matchable, known) })),
      products: matchable.map((row) => ({ id: row.id, name: row.name })),
      totals: checkTotals(reading),
      duplicateBillId: duplicate?.id ?? null,
      billId: scan.bill_id,
      orderId: scan.order_id,
      previous: scan.status === 'waiting' ? ((scan.confirmation as ScanConfirmation | null)?.input ?? null) : null,
    };
  }

  /**
   * Whether the bill can be confirmed on the phone as it stands, and the
   * confirm it would send: every line matched to a product, the supplier known,
   * the lines adding up and no copy already saved. The choices are the check
   * page's own first choices (a new price becomes the cost, a different barcode
   * is left alone). Anything else is finished on the dashboard.
   */
  async quickCheck(id: number, now = new Date()): Promise<QuickCheckDto> {
    const scan = await this.get(id);
    const { reading } = scan;
    const blockers: QuickBlocker[] = [];
    if (scan.status !== 'waiting') blockers.push('decided');
    if (!scan.supplier) blockers.push('supplier');
    if (scan.duplicateBillId !== null) blockers.push('duplicate');
    if (!scan.totals.adds) blockers.push('totals');
    if (scan.lines.length === 0) blockers.push('no_lines');
    if (scan.lines.some(({ match }) => match.productId === null || match.stamp === 'new')) blockers.push('new_product');
    if (scan.lines.some(({ match }) => match.stamp === 'unsure')) blockers.push('unsure');

    const today = zonedDay(now, this.timeZone);
    const issuedOn = reading.issuedOn && reading.issuedOn <= today ? reading.issuedOn : today;
    const gross = reading.totals.gross ?? (reading.totals.net !== null ? reading.totals.net + (reading.totals.vat ?? 0) : scan.totals.linesTotal);
    const amount = roundMoney(gross);
    if (!(amount > 0)) blockers.push('amount');

    const names = new Map(scan.products.map((product) => [product.id, product.name]));
    const input: ConfirmScanInput | null =
      blockers.length > 0 || !scan.supplier
        ? null
        : {
            supplierId: scan.supplier.id,
            orderId: scan.openOrders[0]?.id ?? null,
            categoryId: null,
            bill: {
              number: reading.number,
              issuedOn,
              dueOn: reading.dueOn && reading.dueOn >= issuedOn ? reading.dueOn : null,
              amount,
              // The VAT the bill prints, so the books can claim it back.
              vatAmount: reading.totals.vat !== null && reading.totals.vat >= 0 && reading.totals.vat < amount ? roundMoney(reading.totals.vat) : null,
              note: null,
            },
            lines: scan.lines.map(({ read, match }, readIndex) => ({
              readIndex,
              productId: match.productId,
              newProduct: null,
              code: read.code,
              pieces: match.pieces,
              unitsPerPack: match.unitsPerPack,
              unitCost: match.unitCost,
              updateCost: match.stamp === 'price',
              barcode: read.barcode,
              updateBarcode: false,
            })),
          };
    return {
      id: scan.id,
      supplierName: scan.supplier?.name ?? reading.supplier.name,
      number: reading.number,
      amount: amount > 0 ? amount : null,
      scannedBy: scan.scannedBy,
      scannedAt: scan.scannedAt,
      pages: scan.pages,
      lines: scan.lines.map(({ read, match }) => ({
        name: read.name,
        product: match.productId === null ? null : (names.get(match.productId) ?? null),
        pieces: match.pieces,
        unitCost: match.unitCost,
        oldCost: match.oldCost,
        stamp: match.stamp,
      })),
      blockers,
      input,
    };
  }

  /** Confirm with the quick check's own choices, worked out again now so nothing stale is sent. */
  async quickConfirm(id: number, actorId: number, now = new Date()): Promise<{ billId: number; orderId: number }> {
    const check = await this.quickCheck(id, now);
    if (!check.input) throw new ConflictError('This bill needs choices made on the dashboard before it can be confirmed');
    return this.confirm(id, check.input, actorId, now);
  }

  /** The supplier asked for, else the one whose NUI or name is on the bill. */
  private async findSupplier(reading: BillReading, supplierId?: number): Promise<BillScanDto['supplier']> {
    if (supplierId) {
      const chosen = await this.orderRepository.findSupplier(supplierId);
      if (!chosen) throw new NotFoundError(`Supplier ${supplierId} does not exist`);
      return { id: chosen.id, name: chosen.name, matchedBy: 'chosen' };
    }
    const suppliers = await this.orderRepository.findSuppliers();
    const nui = reading.supplier.nui?.replace(/\D/g, '');
    const byNui = nui ? suppliers.find((row) => row.nui === nui) : undefined;
    if (byNui) return { id: byNui.id, name: byNui.name, matchedBy: 'nui' };
    if (!reading.supplier.name) return null;
    let best: (typeof suppliers)[number] | undefined;
    let score = 0;
    for (const row of suppliers) {
      const similarity = nameSimilarity(reading.supplier.name, row.name);
      if (similarity > score) [best, score] = [row, similarity];
    }
    return best && score >= 0.5 ? { id: best.id, name: best.name, matchedBy: 'name' } : null;
  }

  async confirm(id: number, input: ConfirmScanInput, actorId: number, now = new Date()): Promise<{ billId: number; orderId: number }> {
    const result = await this.transactions.run(async (repos) => {
      await repos.billScans.lock(id);
      const scan = await repos.billScans.findById(id);
      if (!scan) throw new NotFoundError(`Scan ${id} does not exist`);
      if (scan.status !== 'waiting') throw new ConflictError('This scan was already dealt with');
      await closePendingAlerts(repos, { type: 'bill_scan', id });
      const supplier = await repos.orders.findSupplier(input.supplierId);
      if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} does not exist`);
      if (input.lines.length === 0) throw new ValidationError('Nothing to receive: every line was skipped');

      // Everything changed is noted, so the developer can reopen the scan and have it put back.
      const confirmation: ScanConfirmation = { input, createdProducts: [], costs: [], barcodes: [], codes: [], order: { id: 0, created: false, lines: [], addedLineIds: [] }, received: [] };
      // Each line ends up as a product id with pieces and a cost.
      const received = new Map<number, { pieces: number; cost: number | null }>();
      for (const line of input.lines) {
        let productId = line.productId;
        if (productId === null) {
          productId = await this.addProduct(repos, line, input.categoryId, supplier.name, actorId);
          confirmation.createdProducts.push(productId);
        }
        const product = await repos.products.findById(productId, true);
        if (!product) throw new NotFoundError(`Product ${productId} does not exist`);
        if (line.productId && line.updateBarcode && line.barcode && line.barcode !== product.barcode && !product.other_barcodes.includes(line.barcode)) {
          const added = await this.takeBarcode(repos, product, line.barcode, supplier.name, actorId);
          confirmation.barcodes.push({ productId: product.id, from: product.barcode, to: line.barcode, ...(added && { added }) });
        }
        if (line.productId && line.updateCost && line.unitCost !== null) {
          const from = product.cost_price === null ? null : Number(product.cost_price);
          if (!confirmation.costs.some((cost) => cost.productId === product.id)) confirmation.costs.push({ productId: product.id, from, to: line.unitCost });
          else confirmation.costs.find((cost) => cost.productId === product.id)!.to = line.unitCost;
          await changeCost(repos, { productId: product.id, productName: product.name, from: product.cost_price === null ? null : Number(product.cost_price), to: line.unitCost, actorId, because: { scan: supplier.name } });
        }
        if (line.code) {
          const code = line.code.trim().toLowerCase();
          if (!confirmation.codes.some((row) => row.code === code)) {
            const before = await repos.billScans.findCode(supplier.id, code);
            confirmation.codes.push({ code, before: before ? { productId: before.product_id, unitsPerPack: before.units_per_pack } : null });
          }
          await repos.billScans.rememberCode({ supplierId: supplier.id, code, productId, unitsPerPack: line.unitsPerPack, at: now });
        }

        // The same product on two lines (a free extra, a second price) arrives as one, at the average cost.
        const before = received.get(productId);
        if (!before) received.set(productId, { pieces: line.pieces, cost: line.unitCost });
        else {
          const pieces = before.pieces + line.pieces;
          const cost = before.cost !== null && line.unitCost !== null ? roundMoney((before.cost * before.pieces + line.unitCost * line.pieces) / pieces) : (before.cost ?? line.unitCost);
          received.set(productId, { pieces, cost });
        }
      }

      confirmation.order = await this.orderFor(repos, input, received, actorId);
      const orderId = confirmation.order.id;
      confirmation.received = [...received].map(([productId, came]) => ({ productId, pieces: came.pieces }));
      const lines = await repos.orders.findLines([orderId]);
      await receiveOrder(
        repos,
        orderId,
        {
          updateCostPrices: false,
          lines: lines.map((line) => {
            const came = received.get(line.product_id);
            return { lineId: line.id, receivedQuantity: came?.pieces ?? 0, ...(came && came.cost !== null && { unitCost: came.cost }) };
          }),
        },
        actorId,
        now,
      );
      const billId = (await createBill(repos, { ...input.bill, supplierId: supplier.id, orderId }, actorId))!;
      // The first photo becomes the bill's picture; the scan keeps every page.
      const photo = await this.firstPhoto(scan);
      if (photo) await repos.bills.setPhoto(billId, photo);
      await repos.billScans.decide(id, { status: 'confirmed', by: actorId, at: now, billId, orderId, confirmation });
      const pieces = confirmation.received.reduce((sum, came) => sum + came.pieces, 0);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.scan_confirmed',
        entityType: 'bill_scan',
        entityId: id,
        say: { key: 'billScanConfirmed', params: { supplier: supplier.name, pieces, orderId, newProducts: confirmation.createdProducts.length } },
        details: { billId, orderId, createdProducts: confirmation.createdProducts },
      });
      return { billId, orderId };
    });
    return result;
  }

  async discard(id: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      await repos.billScans.lock(id);
      const scan = await repos.billScans.findById(id);
      if (!scan) throw new NotFoundError(`Scan ${id} does not exist`);
      if (scan.status !== 'waiting') throw new ConflictError('This scan was already dealt with');
      await closePendingAlerts(repos, { type: 'bill_scan', id });
      const reading = parseReading(scan);
      await repos.billScans.decide(id, { status: 'discarded', by: actorId, at: now });
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.scan_discarded',
        entityType: 'bill_scan',
        entityId: id,
        say: { key: 'billScanDiscarded', params: { supplier: reading.supplier.name } },
      });
    });
  }

  /** The open order this delivery fills (with anything extra added to it), or a new one. */
  private async orderFor(
    repos: TransactionalRepositories,
    input: ConfirmScanInput,
    received: Map<number, { pieces: number; cost: number | null }>,
    actorId: number,
  ): Promise<ScanConfirmation['order']> {
    const lines = [...received].map(([productId, came]) => ({ productId, quantity: came.pieces, unitCost: came.cost }));
    if (input.orderId === null) {
      const orderId = await repos.orders.createOrder({ supplierId: input.supplierId, note: input.bill.number ? `Bill no. ${input.bill.number}` : null, createdBy: actorId, lines });
      await repos.activityLog.create({
        userId: actorId,
        action: 'order.created',
        entityType: 'order',
        entityId: orderId,
        say: { key: 'orderFromScan', params: { orderId } },
        details: { supplierId: input.supplierId, lines },
      });
      return { id: orderId, created: true, lines: [], addedLineIds: [] };
    }
    const order = await repos.orders.findOrder(input.orderId);
    if (!order || order.supplier_id !== input.supplierId) throw new ValidationError('That order is not from this supplier');
    if (order.status !== 'open') throw new ConflictError('That order is already closed');
    const before = await repos.orders.findLines([order.id]);
    const onOrder = new Set(before.map((line) => line.product_id));
    const addedLineIds = await repos.orders.addLines(order.id, lines.filter((line) => !onOrder.has(line.productId)));
    return {
      id: order.id,
      created: false,
      lines: before.map((line) => ({ id: line.id, unitCost: line.unit_cost === null ? null : Number(line.unit_cost) })),
      addedLineIds,
    };
  }

  /**
   * The developer's way back from a confirmed (or discarded) scan: every change
   * the confirm made is put back, and the scan waits to be checked again with
   * the earlier choices filled in. Editing a confirmed scan is reopen, change,
   * confirm.
   */
  async reopen(id: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      await repos.billScans.lock(id);
      const scan = await repos.billScans.findById(id);
      if (!scan) throw new NotFoundError(`Scan ${id} does not exist`);
      if (scan.status === 'waiting') throw new ConflictError('This scan is still waiting to be checked');
      const reading = parseReading(scan);
      const done = scan.status === 'confirmed' ? (scan.confirmation as ScanConfirmation | null) : null;
      if (scan.status === 'confirmed' && !done) throw new ConflictError('This scan was confirmed before reopening existed; fix its bill and stock by hand');

      if (done) {
        const supplierId = done.input.supplierId;
        const supplierName = (await repos.orders.findSupplier(supplierId))?.name ?? 'the supplier';
        // The stock first: if some of it was sold since, nothing else is touched.
        for (const came of done.received) {
          const product = await repos.products.findById(came.productId, true);
          if (!product) continue;
          try {
            await applyStockChange(repos, {
              productId: product.id,
              productName: product.name,
              delta: -came.pieces,
              reason: SYSTEM_STOCK_REASONS.UNDO,
              notes: `Scanned bill from ${supplierName} reopened`,
              adjustedBy: actorId,
              reorderLevel: product.reorder_level ?? 0,
            });
          } catch (error) {
            if (error instanceof ValidationError) {
              throw new ConflictError(`Only part of the ${came.pieces} × ${product.name} from this bill is still in stock. Count it first, then reopen.`);
            }
            throw error;
          }
        }

        if (scan.bill_id) {
          for (const payment of await repos.bills.findPayments([scan.bill_id])) {
            if (!payment.voided_at) await repos.bills.voidPayment(payment.id, actorId, now);
          }
          await repos.bills.void(scan.bill_id, actorId, `Scan reopened to be checked again (was for order #${done.order.id})`, now);
          await repos.bills.detachOrder(scan.bill_id);
        }

        await repos.orders.reopen(done.order.id, done.order.lines);
        await repos.orders.removeLines(done.order.addedLineIds);
        if (done.order.created) await repos.orders.close(done.order.id, 'cancelled', actorId, now);

        // Values go back only if nobody changed them since.
        for (const change of done.costs) {
          const product = await repos.products.findById(change.productId, true);
          if (product && Number(product.cost_price) === change.to) {
            await changeCost(repos, { productId: product.id, productName: product.name, from: change.to, to: change.from, actorId, because: { reopened: true } });
          }
        }
        for (const change of done.barcodes) {
          const product = await repos.products.findById(change.productId, true);
          if (change.added) {
            if (product && (await repos.products.removeOtherBarcode(product.id, change.to))) {
              await repos.activityLog.create({
                userId: actorId,
                action: 'product.barcode_removed',
                entityType: 'product',
                entityId: product.id,
                say: { key: 'barcodeTakenBack', params: { product: product.name, code: change.to } },
                details: { otherBarcode: change.to },
              });
            }
          } else if (product?.barcode === change.to) {
            await setProductBarcode(repos, {
              product,
              to: change.from,
              actorId,
              say: { key: 'barcodePutBack', params: { product: product.name, to: change.from } },
            });
          }
        }
        for (const row of done.codes) {
          if (row.before) await repos.billScans.rememberCode({ supplierId, code: row.code, productId: row.before.productId, unitsPerPack: row.before.unitsPerPack, at: now });
          else await repos.billScans.forgetCode(supplierId, row.code);
        }
        // Products the bill added go too, unless they were sold in the meantime.
        for (const productId of done.createdProducts) {
          if (!(await repos.products.hasSales(productId))) await repos.products.softDelete(productId);
        }
      }

      await repos.billScans.reopen(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.scan_reopened',
        entityType: 'bill_scan',
        entityId: id,
        say: { key: 'billScanReopened', params: { supplier: reading.supplier.name, undone: Boolean(done) } },
        details: { billId: scan.bill_id, orderId: scan.order_id },
      });
    });
  }

  private async addProduct(
    repos: TransactionalRepositories,
    line: ConfirmScanInput['lines'][number],
    categoryId: number | null,
    supplierName: string,
    actorId: number,
  ): Promise<number> {
    const product = line.newProduct;
    if (!product) throw new ValidationError('Choose a product for every line, or add it as new');
    if (categoryId === null) throw new ValidationError('Choose a category for the new products');
    if (!(await repos.categories.findById(categoryId))) throw new NotFoundError(`Category ${categoryId} does not exist`);
    if (product.barcode && (await repos.products.findIdByBarcode(product.barcode))) {
      throw new ConflictError(`Another product already has the barcode ${product.barcode}`);
    }
    const id = await repos.products.create({
      name: product.name,
      description: null,
      categoryId,
      basePrice: product.price,
      costPrice: line.unitCost,
      imageUrl: null,
      sku: null,
      isActive: true,
      vatRate: product.vatRate,
      vatExempt: false,
      originCountry: countryFromBarcode(product.barcode),
    });
    await repos.inventory.create(id, 0, DEFAULT_REORDER_LEVEL);
    if (product.barcode) await repos.products.setBarcode(id, product.barcode);
    await repos.activityLog.create({
      userId: actorId,
      action: 'product.created',
      entityType: 'product',
      entityId: id,
      say: { key: 'productFromBill', params: { product: product.name, supplier: supplierName } },
      details: { price: product.price, costPrice: line.unitCost, barcode: product.barcode },
    });
    return id;
  }

  /**
   * The barcode printed on the bill goes on the product: as another barcode
   * when it has one already (the same item under a second code), else as its
   * main one. True when it was added as another.
   */
  private async takeBarcode(
    repos: TransactionalRepositories,
    product: { id: number; name: string; barcode: string | null; origin_country: string | null },
    to: string,
    supplierName: string,
    actorId: number,
  ): Promise<boolean> {
    const holder = await repos.products.findIdByBarcode(to);
    if (holder && holder !== product.id) throw new ConflictError(`Another product already has the barcode ${to}`);
    if (product.barcode) {
      await addProductBarcode(repos, { product, code: to, actorId, say: { key: 'barcodeAddedFromBill', params: { product: product.name, code: to, supplier: supplierName } } });
      return true;
    }
    await setProductBarcode(repos, {
      product,
      to,
      actorId,
      say: { key: 'barcodeFromBill', params: { product: product.name, from: product.barcode, to, supplier: supplierName } },
    });
    return false;
  }

  private async firstPhoto(scan: BillScanRecord): Promise<string | null> {
    const mimes = await this.mediaService.mimes(scan.media_ids);
    return scan.media_ids.find((id) => mimes.get(id) !== 'application/pdf') ?? null;
  }
}

/** Stored readings were checked on the way in; parsing again keeps the types honest. */
function parseReading(scan: BillScanRecord): BillReading {
  return billReadingSchema.parse(scan.reading);
}
