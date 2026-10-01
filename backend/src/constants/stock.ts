/** Reasons a person can pick when adjusting stock by hand. */
export const MANUAL_STOCK_REASONS = ['Restock', 'Return', 'Damage', 'Recount', 'Manual adjustment'] as const;

/** Reasons the system records on its own. */
export const SYSTEM_STOCK_REASONS = {
  INITIAL_STOCK: 'Initial stock',
  SALE: 'Sale',
} as const;

export const DEFAULT_REORDER_LEVEL = 10;

/** How many past adjustments to show on a product's inventory page. */
export const RECENT_ADJUSTMENTS_LIMIT = 20;
