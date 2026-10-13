import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { ProductRequestRecord, ProductRequestRepository } from '../repositories/ProductRequestRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { PublicUser } from '../types/auth.js';
import { countryFromBarcode } from '../utils/barcodeCountry.js';
import { hasValidCheckDigit } from '../utils/barcodes.js';
import { formatEuro } from '../utils/money.js';
import { canEditProducts } from '../utils/roles.js';
import { assertPending, closePendingAlerts, notifyAdminsOfPending, notifyRequester } from './approvals/approvalHelpers.js';
import { mediaUrl, toMoney } from './mappers.js';
import type { MediaService } from './MediaService.js';
import type { ProductService } from './ProductService.js';

/** The photo is shrunk like any product photo; this is only the upload's limit. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export interface ProductRequestInput {
  name: string;
  categoryId: number | null;
  price: number;
  vatRate: number;
  barcode: string | null;
  /** Left out, it comes from the barcode. */
  originCountry?: string | null;
  stock: number;
  note: string | null;
  /** A photo from the phone, as base64. */
  photo: { mime: string; data: string } | null;
}

/** What the person deciding may correct before approving. */
export type ApprovalEdits = Partial<Pick<ProductRequestInput, 'name' | 'categoryId' | 'price' | 'vatRate' | 'barcode' | 'originCountry' | 'stock'>>;

export interface ProductRequestDto {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  name: string;
  category: { id: number; name: string } | null;
  price: number;
  vatRate: number;
  barcode: string | null;
  originCountry: string | null;
  photoUrl: string | null;
  stock: number;
  note: string | null;
  requestedBy: { id: number; name: string } | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  productId: number | null;
}

export type RequestOutcome = { kind: 'request'; request: ProductRequestDto } | { kind: 'product'; productId: number };

/**
 * New products from the counter. Someone who runs the shop adds a product
 * straight away; anyone else's goes in as a request that waits until the
 * developer, an admin or the owner approves it (with corrections) or rejects
 * it. Only approving creates the product, through ProductService, so every
 * rule and log entry of a normal add applies.
 */
export class ProductRequestService {
  constructor(
    private readonly repository: ProductRequestRepository,
    private readonly productService: ProductService,
    private readonly mediaService: MediaService,
    private readonly transactions: TransactionManager,
  ) {}

  async submit(input: ProductRequestInput, actor: PublicUser): Promise<RequestOutcome> {
    if (input.barcode !== null) await this.assertBarcodeFree(input.barcode);
    const photoMediaId = input.photo ? await this.storePhoto(input.photo) : null;

    if (canEditProducts(actor.role)) {
      try {
        const productId = await this.createProduct({ ...input, photoMediaId }, actor.id, null);
        return { kind: 'product', productId };
      } catch (error) {
        await this.mediaService.remove(photoMediaId);
        throw error;
      }
    }

    const id = await this.transactions.run(async (repos) => {
      const requestId = await repos.productRequests.create({
        name: input.name,
        categoryId: input.categoryId,
        price: input.price,
        vatRate: input.vatRate,
        barcode: input.barcode,
        originCountry: input.originCountry ?? countryFromBarcode(input.barcode),
        photoMediaId,
        stock: input.stock,
        note: input.note,
        requestedBy: actor.id,
      });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'product.requested',
        entityType: 'product_request',
        entityId: requestId,
        say: { key: 'productRequested', params: { name: input.name, price: input.price } },
        details: { price: input.price, barcode: input.barcode, stock: input.stock },
      });
      await notifyAdminsOfPending(repos, 'product', { type: 'product_request', id: requestId }, (t) =>
        t.productPending({ name: actor.name, product: input.name, price: formatEuro(input.price) }),
      );
      return requestId;
    });
    return { kind: 'request', request: await this.get(id) };
  }

  async pending(): Promise<ProductRequestDto[]> {
    return (await this.repository.findPending()).map(toDto);
  }

  async get(id: number): Promise<ProductRequestDto> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundError(`Product request ${id} does not exist`);
    return toDto(row);
  }

  /**
   * Creates the product from the request with the decider's corrections. The
   * request is claimed first (so a second tap is refused) and put back to
   * waiting if creating the product fails.
   */
  async approve(id: number, edits: ApprovalEdits, actor: PublicUser): Promise<ProductRequestDto> {
    await this.transactions.run(async (repos) => {
      const status = await repos.productRequests.lockStatus(id);
      if (!status) throw new NotFoundError(`Product request ${id} does not exist`);
      assertPending(status, 'product request');
      await repos.productRequests.decide(id, { status: 'approved', by: actor.id, note: null, productId: null });
    });
    const request = (await this.repository.findById(id))!;
    const final = {
      name: edits.name ?? request.name,
      categoryId: edits.categoryId === undefined ? request.category_id : edits.categoryId,
      price: edits.price ?? toMoney(request.price),
      vatRate: edits.vatRate ?? request.vat_rate,
      barcode: edits.barcode === undefined ? request.barcode : edits.barcode,
      originCountry: edits.originCountry === undefined ? request.origin_country : edits.originCountry,
      stock: edits.stock ?? request.stock,
      note: request.note,
      photoMediaId: request.photo_media_id,
    };

    let productId: number;
    try {
      if (final.barcode !== null) await this.assertBarcodeFree(final.barcode);
      productId = await this.createProduct(final, actor.id, request);
    } catch (error) {
      await this.repository.decide(id, { status: 'pending', by: null, note: null, productId: null });
      throw error;
    }

    await this.transactions.run(async (repos) => {
      await repos.productRequests.decide(id, { status: 'approved', by: actor.id, note: null, productId });
      await closePendingAlerts(repos, { type: 'product_request', id });
      await repos.activityLog.create({
        userId: actor.id,
        action: 'product.request_approved',
        entityType: 'product_request',
        entityId: id,
        say: { key: 'productRequestApproved', params: { name: final.name, by: request.requested_by_name } },
        details: { productId },
      });
      await notifyRequester(repos, request.requested_by, actor.id, (t) => ({ title: t.productApproved(final.name), message: t.productApprovedMessage }));
    });
    return this.get(id);
  }

  async reject(id: number, note: string, actor: PublicUser): Promise<ProductRequestDto> {
    const request = await this.transactions.run(async (repos) => {
      const status = await repos.productRequests.lockStatus(id);
      if (!status) throw new NotFoundError(`Product request ${id} does not exist`);
      assertPending(status, 'product request');
      await repos.productRequests.decide(id, { status: 'rejected', by: actor.id, note, productId: null });
      await closePendingAlerts(repos, { type: 'product_request', id });
      const row = (await repos.productRequests.findById(id))!;
      await repos.activityLog.create({
        userId: actor.id,
        action: 'product.request_rejected',
        entityType: 'product_request',
        entityId: id,
        say: { key: 'productRequestRejected', params: { name: row.name, note } },
      });
      await notifyRequester(repos, row.requested_by, actor.id, (t) => ({ title: t.productRejected(row.name), message: note }));
      return row;
    });
    // The photo was only kept for the request.
    await this.mediaService.remove(request.photo_media_id);
    return this.get(id);
  }

  /** The product, made the normal way: details and starting stock, then its barcode (which fills its country). */
  private async createProduct(
    input: Omit<ProductRequestInput, 'photo'> & { photoMediaId: string | null },
    actorId: number,
    request: ProductRequestRecord | null,
  ): Promise<number> {
    if (input.categoryId === null) throw new ValidationError('Choose a category for the product');
    const product = await this.productService.create(
      {
        name: input.name,
        description: null,
        categoryId: input.categoryId,
        price: input.price,
        costPrice: null,
        imageUrl: mediaUrl(input.photoMediaId),
        sku: null,
        isActive: true,
        vatRate: input.vatRate,
        originCountry: input.originCountry ?? null,
        stock: input.stock,
      },
      actorId,
      request ? { requestId: request.id, requestedBy: request.requested_by_name } : undefined,
    );
    if (input.barcode !== null) await this.productService.setBarcode(product.id, input.barcode, actorId);
    return product.id;
  }

  private async assertBarcodeFree(barcode: string): Promise<void> {
    if (!hasValidCheckDigit(barcode)) {
      throw new ValidationError(`${barcode} isn't a valid barcode: its last digit doesn't match. Scan it again or check for a typo.`);
    }
    const owner = await this.productService.getByBarcode(barcode, 'admin').catch((error: unknown) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    });
    if (owner) throw new ConflictError(`${owner.name} already has the barcode ${barcode}`);
  }

  private async storePhoto(photo: { mime: string; data: string }): Promise<string> {
    const bytes = Buffer.from(photo.data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) throw new ValidationError('The photo must be under 10 MB');
    return this.mediaService.store(null, bytes, 'product');
  }
}

function toDto(row: ProductRequestRecord): ProductRequestDto {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    category: row.category_id === null ? null : { id: row.category_id, name: row.category_name ?? '' },
    price: toMoney(row.price),
    vatRate: row.vat_rate,
    barcode: row.barcode,
    originCountry: row.origin_country,
    photoUrl: mediaUrl(row.photo_media_id),
    stock: row.stock,
    note: row.note,
    requestedBy: row.requested_by === null ? null : { id: row.requested_by, name: row.requested_by_name ?? 'Removed user' },
    requestedAt: row.requested_at.toISOString(),
    decidedBy: row.decided_by_name,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionNote: row.decision_note,
    productId: row.product_id,
  };
}

