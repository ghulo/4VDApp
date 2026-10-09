import { ConflictError, NotFoundError } from '../../errors/httpErrors.js';
import type { UndoRepository } from '../../repositories/UndoRepository.js';
import type { PublicUser } from '../../types/auth.js';
import type { InventoryService } from '../InventoryService.js';
import type { PricingTier } from '../pricing/bulkPricing.js';
import type { PricingService } from '../PricingService.js';
import type { ProductInput, ProductService } from '../ProductService.js';
import type { PromotionService } from '../PromotionService.js';
import type { AppSettings, SettingsService } from '../SettingsService.js';
import type { UndoTarget } from './undoRules.js';

type Mode = 'undo' | 'restore';
type Change = { from: unknown; to: unknown };

export interface EditEntry {
  id: number;
  action: string;
  entity_id: number | null;
  details: Record<string, unknown> | null;
}

/** The fields an edit entry changed, keyed as the product, settings or stock services name them. */
export function changedFields(entry: { action: string; details: Record<string, unknown> | null }): string[] {
  const details = entry.details ?? {};
  switch (entry.action) {
    case 'pricing.updated':
      return ['bulkPricingTiers'];
    case 'stock.adjusted':
      return 'reorderLevel' in details ? ['reorderLevel'] : [];
    case 'product.updated':
    case 'settings.updated':
      return Object.keys(details).filter((key) => key !== 'undoOf');
    default:
      return [];
  }
}

/** Which later entries could have changed the same fields. */
function laterScope(target: UndoTarget, entry: EditEntry) {
  if (target.kind === 'settings_edit') return { entityType: 'settings' as const, entityId: null, actions: ['settings.updated'] };
  if (target.kind === 'reorder_edit') return { entityType: 'product' as const, entityId: entry.entity_id, actions: ['stock.adjusted'] };
  return { entityType: 'product' as const, entityId: entry.entity_id, actions: ['product.updated', 'pricing.updated'] };
}

/**
 * Reverting (and restoring) edits: product details, bulk prices, settings,
 * reorder levels and promotions. The old values are put back through the same
 * services a person uses, so every rule and log entry still applies; the
 * logged change carries `undoOf` so it isn't mistaken for a new edit.
 */
export class EditReverts {
  constructor(
    private readonly undoRepository: UndoRepository,
    private readonly productService: ProductService,
    private readonly pricingService: PricingService,
    private readonly settingsService: SettingsService,
    private readonly inventoryService: InventoryService,
    private readonly promotionService: PromotionService,
  ) {}

  /** Refuse when this isn't the latest change to these fields, or can't be redone. Call while the entry is locked. */
  async check(target: UndoTarget, entry: EditEntry, mode: Mode): Promise<void> {
    if (target.kind === 'promotion') {
      if (mode === 'restore') throw new ConflictError("An ended promotion can't be restarted. Start a new promotion instead.");
      return;
    }
    const fields = new Set(changedFields(entry));
    const later = await this.undoRepository.laterEntries(entry.id, laterScope(target, entry));
    if (later.some((other) => changedFields(other).some((field) => fields.has(field)))) {
      throw new ConflictError('Changed again since · revert the newer change first');
    }
  }

  /** Put the old values back (undo) or the new ones again (restore). Returns what to call it in alerts. */
  async apply(target: UndoTarget, entry: EditEntry, mode: Mode, actor: PublicUser): Promise<{ what: string | null; fields: unknown[] }> {
    const logExtra = { undoOf: entry.id };
    const details = entry.details ?? {};
    const valueOf = (field: string) => (details[field] as Change)[mode === 'undo' ? 'from' : 'to'];
    const fields = changedFields(entry).map((field) => {
      const change = details[field] as Change | undefined;
      if (field === 'bulkPricingTiers' && entry.action === 'pricing.updated') {
        return { field, from: mode === 'undo' ? details.to : details.from, to: mode === 'undo' ? details.from : details.to };
      }
      return { field, from: mode === 'undo' ? change?.to : change?.from, to: valueOf(field) };
    });

    switch (target.kind) {
      case 'product_edit': {
        const product = await this.existingProduct(entry.entity_id);
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
        };
        for (const field of changedFields(entry)) (input as unknown as Record<string, unknown>)[field] = valueOf(field);
        const saved = await this.productService.update(product.id, input, actor.id, logExtra);
        return { what: saved.name, fields };
      }
      case 'pricing_edit': {
        const product = await this.existingProduct(entry.entity_id);
        const tiers = (mode === 'undo' ? details.from : details.to) as PricingTier[];
        await this.pricingService.replaceTiers(product.id, tiers, actor.id, logExtra);
        return { what: product.name, fields };
      }
      case 'reorder_edit': {
        const product = await this.existingProduct(entry.entity_id);
        await this.inventoryService.adjust(product.id, { reorderLevel: valueOf('reorderLevel') as number, notes: null }, actor.id, logExtra);
        return { what: product.name, fields };
      }
      case 'settings_edit': {
        const input = Object.fromEntries(changedFields(entry).map((field) => [field, valueOf(field)])) as Partial<AppSettings>;
        await this.settingsService.update(input, actor.id, logExtra);
        return { what: null, fields };
      }
      case 'promotion': {
        const promotion = await this.promotionService.endEarly(target.id, actor.id, logExtra);
        return { what: `"${promotion.name}"`, fields: [] };
      }
      default:
        throw new NotFoundError("This entry can't be undone");
    }
  }

  private async existingProduct(id: number | null) {
    if (id === null) throw new NotFoundError("This entry can't be undone");
    try {
      return await this.productService.getById(id, 'admin');
    } catch (error) {
      if (error instanceof NotFoundError) throw new ConflictError("This product was deleted, so its edit can't be reverted");
      throw error;
    }
  }
}
