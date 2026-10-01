/** Reasons a person can pick when adjusting stock by hand. */
// Returns, damage and recounts have their own flows now, so losses are always valued and reviewed.
export const MANUAL_STOCK_REASONS = ['Restock', 'Manual adjustment'] as const;

/** Reasons the system records on its own. */
export const SYSTEM_STOCK_REASONS = {
  INITIAL_STOCK: 'Initial stock',
  SALE: 'Sale',
  RETURN: 'Return',
  WRITE_OFF: 'Write-off',
  RECOUNT: 'Recount',
} as const;

export const DEFAULT_REORDER_LEVEL = 10;

/** How many past adjustments to show on a product's inventory page. */
export const RECENT_ADJUSTMENTS_LIMIT = 20;
