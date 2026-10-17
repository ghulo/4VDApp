import { ConflictError, NotFoundError } from '../../errors/httpErrors.js';
import type { ActivityLogRepository } from '../../repositories/ActivityLogRepository.js';
import type { PurchaseOrderRepository } from '../../repositories/PurchaseOrderRepository.js';
import type { UserRepository } from '../../repositories/UserRepository.js';
import type { PublicUser } from '../../types/auth.js';
import { type FieldChange, fieldChangesOf } from '../activity/fieldChanges.js';
import type { BusinessService } from '../BusinessService.js';
import type { ProductInput, ProductService } from '../ProductService.js';
import type { PurchaseOrderService } from '../PurchaseOrderService.js';
import type { CustomerInput, TabService } from '../TabService.js';
import type { UserService } from '../UserService.js';

/** Records a developer can put back to an earlier point, and the fields that go back. */
const RESTORABLE = {
  product: ['name', 'description', 'categoryId', 'price', 'costPrice', 'sku', 'isActive', 'vatRate', 'vatExempt', 'originCountry', 'bulkPricingTiers', 'barcode'],
  user: ['name', 'role', 'isActive'],
  supplier: ['name', 'nui', 'phone', 'email', 'note'],
  customer: ['name', 'kind', 'nui', 'phone', 'note'],
  business: ['name', 'address', 'phone', 'nui', 'timeZone', 'bankName', 'iban', 'invoiceNote'],
} as const;

type RestorableType = keyof typeof RESTORABLE;
type Values = Record<string, unknown>;

export interface RestorePlan {
  entityType: RestorableType;
  entityId: number;
  /** The newest entry the plan was worked out from; applying refuses if a newer one appeared. */
  latestEntryId: number;
  /** Each field that goes back: `from` is what it is now, `to` what it was at that point. */
  changes: FieldChange[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Put a record back to how it was right after one of its history entries:
 * every field changed since goes back to the value it had then (the `from` of
 * its first later change). Stock, sales and money are not touched; those have
 * their own undo. Old values go back through the normal services, so every
 * rule still applies, and each change is logged with `restoredTo`, so a
 * restore can itself be restored past. Developer only (checked by the route).
 */
export class RecordRestoreService {
  constructor(
    private readonly activityLogRepository: ActivityLogRepository,
    private readonly productService: ProductService,
    private readonly userService: UserService,
    private readonly userRepository: UserRepository,
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly orderRepository: PurchaseOrderRepository,
    private readonly tabService: TabService,
    private readonly businessService: BusinessService,
  ) {}

  /** What restoring to `entryId` would change, without changing it. */
  async plan(entryId: number, actor: PublicUser): Promise<RestorePlan> {
    const { entries } = await this.activityLogRepository.findMany({ id: entryId, limit: 1, offset: 0 });
    const entry = entries[0];
    if (!entry) throw new NotFoundError(`Activity entry ${entryId} does not exist`);
    const entityType = entry.entity_type as RestorableType;
    if (!(entityType in RESTORABLE) || entry.entity_id === null) throw new ConflictError("This record can't be restored to an earlier point");
    const entityId = entry.entity_id;

    const fields = new Set<string>(RESTORABLE[entityType]);
    const later = await this.activityLogRepository.findAfter(entityType, entityId, entry.id);
    const then = new Map<string, unknown>();
    for (const other of later) {
      for (const change of fieldChangesOf(other)) {
        if (fields.has(change.field) && !then.has(change.field)) then.set(change.field, change.from);
      }
    }

    const now = await this.current(entityType, entityId, actor);
    const changes = [...then]
      .filter(([field, value]) => !same(now[field], value))
      .map(([field, value]) => ({ field, from: now[field] ?? null, to: value ?? null }));
    return { entityType, entityId, latestEntryId: later.at(-1)?.id ?? entry.id, changes };
  }

  /** Restore to `entryId`, refusing if the record changed after `latestEntryId` (what the developer was shown). */
  async apply(entryId: number, latestEntryId: number, actor: PublicUser): Promise<RestorePlan> {
    const plan = await this.plan(entryId, actor);
    if (plan.latestEntryId !== latestEntryId) throw new ConflictError('This changed while you were looking. Check what a restore does again.');
    if (plan.changes.length === 0) throw new ConflictError('It is already like this, so there is nothing to restore');

    const to = Object.fromEntries(plan.changes.map((change) => [change.field, change.to]));
    const logExtra = { restoredTo: entryId };
    const { entityId } = plan;
    switch (plan.entityType) {
      case 'product': {
        const { barcode, ...rest } = to;
        // The barcode first: it is the one most likely to be refused (taken by another product since).
        if ('barcode' in to) await this.productService.setBarcode(entityId, barcode as string | null, actor.id, logExtra);
        if (Object.keys(rest).length > 0) {
          const product = await this.productService.getById(entityId, 'admin');
          const input: ProductInput = {
            name: product.name,
            description: product.description,
            categoryId: product.category.id,
            price: product.price,
            costPrice: product.costPrice ?? null,
            imageUrl: product.imageUrl,
            sku: product.sku,
            isActive: product.isActive,
            vatRate: product.vatRate,
            vatExempt: product.vatExempt,
            originCountry: product.originCountry,
            ...rest,
          };
          await this.productService.update(entityId, input, actor.id, logExtra);
        }
        break;
      }
      case 'user':
        await this.userService.update(entityId, to, actor.id, logExtra);
        break;
      case 'supplier': {
        const { id: _id, ...fields } = (await this.orderRepository.findSupplier(entityId))!;
        await this.purchaseOrderService.updateSupplier(entityId, { ...fields, ...to }, actor.id, logExtra);
        break;
      }
      case 'customer': {
        const customer = await this.tabService.detail(entityId);
        const fields: CustomerInput = { name: customer.name, kind: customer.kind, nui: customer.nui, phone: customer.phone, note: customer.note };
        await this.tabService.update(entityId, { ...fields, ...to }, actor.id, logExtra);
        break;
      }
      case 'business':
        await this.businessService.update(actor.id, to, logExtra);
        break;
    }
    return plan;
  }

  /** The record's restorable fields as they are now, named as its history names them. */
  private async current(entityType: RestorableType, id: number, actor: PublicUser): Promise<Values> {
    const gone = () => new ConflictError('This record was removed, so it cannot be restored');
    switch (entityType) {
      case 'product': {
        const product = await this.productService.getById(id, 'admin').catch((error: unknown) => {
          throw error instanceof NotFoundError ? gone() : error;
        });
        return { ...product, categoryId: product.category.id, costPrice: product.costPrice ?? null };
      }
      case 'user': {
        const user = await this.userRepository.findById(id);
        if (!user) throw gone();
        return { name: user.name, role: user.role, isActive: user.is_active };
      }
      case 'supplier': {
        const supplier = await this.orderRepository.findSupplier(id);
        if (!supplier) throw gone();
        return { ...supplier };
      }
      case 'customer':
        return { ...(await this.tabService.detail(id)) };
      case 'business': {
        const business = await this.businessService.get(actor.id);
        if (business.id !== id) throw gone();
        return { ...business };
      }
    }
  }
}
