import type { ProductField, Say } from '../../i18n/activityText.js';
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
  vatRate: number;
  vatExempt: boolean;
  originCountry: string | null;
  /** Undefined means "not part of this change". */
  bulkPricingTiers?: PricingTier[];
}

/** Every field a change is checked for, in the order sentences name them. */
const FIELDS: ProductField[] = ['name', 'description', 'categoryId', 'price', 'costPrice', 'imageUrl', 'sku', 'isActive', 'vatRate', 'vatExempt', 'originCountry', 'bulkPricingTiers'];

type FieldChanges = Partial<Record<keyof ProductSnapshot, { from: unknown; to: unknown }>>;

/**
 * Turn a before/after pair into one readable sentence plus the changed
 * fields. Returns null when nothing changed, so no empty entry is logged.
 */
export function describeProductChanges(
  before: ProductSnapshot,
  after: ProductSnapshot,
): { say: Say; details: FieldChanges } | null {
  const details: FieldChanges = {};
  for (const field of FIELDS) {
    if (field === 'bulkPricingTiers' && after.bulkPricingTiers === undefined) continue;
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      details[field] = { from: before[field], to: after[field] };
    }
  }

  const changed = Object.keys(details) as Array<keyof ProductSnapshot>;
  if (changed.length === 0) return null;

  const also = (headline: ProductField) => changed.filter((field) => field !== headline);
  let say: Say;
  if (details.price) {
    say = { key: 'productPriceChanged', params: { name: after.name, from: before.price, to: after.price, also: also('price') } };
  } else if (details.isActive) {
    say = { key: after.isActive ? 'productShown' : 'productHidden', params: { name: after.name, also: also('isActive') } };
  } else if (details.name) {
    say = { key: 'productRenamed', params: { from: before.name, to: after.name, also: also('name') } };
  } else {
    say = { key: 'productEdited', params: { name: after.name, fields: changed } };
  }
  return { say, details };
}
