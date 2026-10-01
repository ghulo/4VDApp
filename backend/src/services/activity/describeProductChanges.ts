import { formatEuro } from '../../utils/money.js';
import type { PricingTier } from '../pricing/bulkPricing.js';

export interface ProductSnapshot {
  name: string;
  description: string | null;
  categoryId: number;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  sku: string | null;
  isActive: boolean;
  /** Undefined means "not part of this change". */
  bulkPricingTiers?: PricingTier[];
}

const FIELD_LABELS: Record<keyof ProductSnapshot, string> = {
  name: 'name',
  description: 'description',
  categoryId: 'category',
  price: 'price',
  costPrice: 'cost price',
  imageUrl: 'image',
  sku: 'SKU',
  isActive: 'visibility',
  bulkPricingTiers: 'bulk prices',
};

type FieldChanges = Partial<Record<keyof ProductSnapshot, { from: unknown; to: unknown }>>;

/**
 * Turn a before/after pair into one readable sentence plus the changed
 * fields. Returns null when nothing changed, so no empty entry is logged.
 */
export function describeProductChanges(
  before: ProductSnapshot,
  after: ProductSnapshot,
): { summary: string; details: FieldChanges } | null {
  const details: FieldChanges = {};
  for (const field of Object.keys(FIELD_LABELS) as Array<keyof ProductSnapshot>) {
    if (field === 'bulkPricingTiers' && after.bulkPricingTiers === undefined) continue;
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      details[field] = { from: before[field], to: after[field] };
    }
  }

  const changed = Object.keys(details) as Array<keyof ProductSnapshot>;
  if (changed.length === 0) return null;

  let headline: keyof ProductSnapshot | null = null;
  let summary: string;
  if (details.price) {
    headline = 'price';
    summary = `Changed price of ${after.name} from ${formatEuro(before.price)} to ${formatEuro(after.price)}`;
  } else if (details.isActive) {
    headline = 'isActive';
    summary = after.isActive ? `Showed ${after.name} in the app` : `Hid ${after.name} from the app`;
  } else if (details.name) {
    headline = 'name';
    summary = `Renamed ${before.name} to ${after.name}`;
  } else {
    summary = `Edited ${after.name}: ${changed.map((field) => FIELD_LABELS[field]).join(', ')}`;
  }

  const others = changed.filter((field) => field !== headline);
  if (headline && others.length > 0) {
    summary += ` (also changed ${others.map((field) => FIELD_LABELS[field]).join(', ')})`;
  }
  return { summary, details };
}
