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
  'user.invited',
  'user.updated',
  'user.deleted',
  'return.requested',
  'return.approved',
  'return.rejected',
  'write_off.requested',
  'write_off.approved',
  'write_off.rejected',
  'count.started',
  'count.submitted',
  'count.cancelled',
  'count.line_approved',
  'count.line_rejected',
  'settings.updated',
  'promotion.created',
  'promotion.ended',
  'carwash.recorded',
  'carwash.removed',
  'undo.applied',
  'undo.restored',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_ENTITY_TYPES = ['product', 'category', 'user', 'sale', 'return', 'write_off', 'stock_count', 'settings', 'promotion', 'carwash', 'activity'] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];
