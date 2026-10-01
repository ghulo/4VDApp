import type { NewNotification } from '../../repositories/NotificationRepository.js';

export interface StockChange {
  productName: string;
  before: number;
  after: number;
  reorderLevel: number;
}

export function isLowStock(quantity: number, reorderLevel: number): boolean {
  return quantity <= reorderLevel;
}

/**
 * Decide whether a stock change deserves a notification. We only alert when
 * stock *crosses* a threshold, so selling the 5th, 4th and 3rd unit of a
 * low-stock product does not send three identical alerts.
 */
export function getStockAlert(change: StockChange): NewNotification | null {
  const { productName, before, after, reorderLevel } = change;

  if (before > 0 && after === 0) {
    return {
      type: 'out_of_stock',
      title: `Out of stock: ${productName}`,
      message: `${productName} has run out. Restock it to keep selling.`,
    };
  }

  if (!isLowStock(before, reorderLevel) && isLowStock(after, reorderLevel)) {
    return {
      type: 'low_stock',
      title: `Low stock: ${productName}`,
      message: `Only ${after} left of ${productName} (reorder level is ${reorderLevel}).`,
    };
  }

  return null;
}
