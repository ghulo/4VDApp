import { DEFAULT_REORDER_LEVEL } from '../constants/stock.js';
import { AiUnavailableError, ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { BillScanRecord, BillScanRepository } from '../repositories/BillScanRepository.js';
import type { ProductRepository } from '../repositories/ProductRepository.js';
import type { PurchaseOrderRepository } from '../repositories/PurchaseOrderRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { checkTotals, type KnownCode, type LineMatch, matchLine, nameSimilarity } from '../utils/billMatching.js';
import { roundMoney } from '../utils/money.js';
import { type BillPage, type BillReader, type BillReading, billReadingSchema } from './ai/billReader.js';
import { mediaUrl } from './mappers.js';
import type { MediaService } from './MediaService.js';
import { type OrderDto, type PurchaseOrderService, receiveOrder } from './PurchaseOrderService.js';
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
  ) {}

  async scan(pages: UploadedPage[], actorId: number): Promise<ScanReceiptDto> {
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
          summary: `Scanned a bill${reading.supplier.name ? ` from ${reading.supplier.name}` : ''} (${reading.lines.length} ${reading.lines.length === 1 ? 'line' : 'lines'})`,
        });
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
    };
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
      const supplier = await repos.orders.findSupplier(input.supplierId);
      if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} does not exist`);
      if (input.lines.length === 0) throw new ValidationError('Nothing to receive: every line was skipped');

      // Each line ends up as a product id with pieces and a cost.
      const received = new Map<number, { pieces: number; cost: number | null }>();
      for (const line of input.lines) {
        const productId = line.productId ?? (await this.addProduct(repos, line, input.categoryId, supplier.name, actorId));
        const product = await repos.products.findById(productId, true);
        if (!product) throw new NotFoundError(`Product ${productId} does not exist`);
        if (line.productId && line.updateBarcode && line.barcode && line.barcode !== product.barcode) {
          await this.setBarcode(repos, product.id, product.name, product.barcode, line.barcode, supplier.name, actorId);
        }
        if (line.productId && line.updateCost && line.unitCost !== null) await repos.orders.setCostPrice(product.id, line.unitCost);
        if (line.code) await repos.billScans.rememberCode({ supplierId: supplier.id, code: line.code, productId, unitsPerPack: line.unitsPerPack, at: now });

        // The same product on two lines (a free extra, a second price) arrives as one, at the average cost.
        const before = received.get(productId);
        if (!before) received.set(productId, { pieces: line.pieces, cost: line.unitCost });
        else {
          const pieces = before.pieces + line.pieces;
          const cost = before.cost !== null && line.unitCost !== null ? roundMoney((before.cost * before.pieces + line.unitCost * line.pieces) / pieces) : (before.cost ?? line.unitCost);
          received.set(productId, { pieces, cost });
        }
      }

      const orderId = await this.orderFor(repos, input, received, actorId);
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
      const billId = await createBill(repos, { ...input.bill, supplierId: supplier.id, orderId }, actorId);
      // The first photo becomes the bill's picture; the scan keeps every page.
      const photo = await this.firstPhoto(scan);
      if (photo) await repos.bills.setPhoto(billId, photo);
      await repos.billScans.decide(id, { status: 'confirmed', by: actorId, at: now, billId, orderId });
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
      const reading = parseReading(scan);
      await repos.billScans.decide(id, { status: 'discarded', by: actorId, at: now });
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.scan_discarded',
        entityType: 'bill_scan',
        entityId: id,
        summary: `Discarded a scanned bill${reading.supplier.name ? ` from ${reading.supplier.name}` : ''}`,
      });
    });
  }

  /** The open order this delivery fills (with anything extra added to it), or a new one. */
  private async orderFor(
    repos: TransactionalRepositories,
    input: ConfirmScanInput,
    received: Map<number, { pieces: number; cost: number | null }>,
    actorId: number,
  ): Promise<number> {
    const lines = [...received].map(([productId, came]) => ({ productId, quantity: came.pieces, unitCost: came.cost }));
    if (input.orderId === null) {
      const orderId = await repos.orders.createOrder({ supplierId: input.supplierId, note: input.bill.number ? `Bill no. ${input.bill.number}` : null, createdBy: actorId, lines });
      await repos.activityLog.create({
        userId: actorId,
        action: 'order.created',
        entityType: 'order',
        entityId: orderId,
        summary: `Made order #${orderId} from a scanned bill`,
        details: { supplierId: input.supplierId, lines },
      });
      return orderId;
    }
    const order = await repos.orders.findOrder(input.orderId);
    if (!order || order.supplier_id !== input.supplierId) throw new ValidationError('That order is not from this supplier');
    if (order.status !== 'open') throw new ConflictError('That order is already closed');
    const onOrder = new Set((await repos.orders.findLines([order.id])).map((line) => line.product_id));
    await repos.orders.addLines(order.id, lines.filter((line) => !onOrder.has(line.productId)));
    return order.id;
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
    });
    await repos.inventory.create(id, 0, DEFAULT_REORDER_LEVEL);
    if (product.barcode) await repos.products.setBarcode(id, product.barcode);
    await repos.activityLog.create({
      userId: actorId,
      action: 'product.created',
      entityType: 'product',
      entityId: id,
      summary: `Added product ${product.name} from ${supplierName}'s bill`,
      details: { price: product.price, costPrice: line.unitCost, barcode: product.barcode },
    });
    return id;
  }

  private async setBarcode(
    repos: TransactionalRepositories,
    productId: number,
    name: string,
    from: string | null,
    to: string,
    supplierName: string,
    actorId: number,
  ): Promise<void> {
    const holder = await repos.products.findIdByBarcode(to);
    if (holder && holder !== productId) throw new ConflictError(`Another product already has the barcode ${to}`);
    await repos.products.setBarcode(productId, to);
    await repos.activityLog.create({
      userId: actorId,
      action: 'product.updated',
      entityType: 'product',
      entityId: productId,
      summary: `Changed the barcode of ${name}${from ? ` from ${from}` : ''} to ${to}, as on ${supplierName}'s bill`,
      details: { barcode: { from, to } },
    });
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
