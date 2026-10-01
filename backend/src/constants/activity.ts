export const ACTIVITY_ACTIONS = [
  'auth.logged_in',
  'product.created',
  'product.updated',
  'product.deleted',
  'pricing.updated',
  'stock.adjusted',
  'sale.recorded',
  'category.created',
  'category.updated',
  'category.deleted',
  'user.created',
  'user.updated',
  'user.deleted',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_ENTITY_TYPES = ['product', 'category', 'user', 'sale'] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];
