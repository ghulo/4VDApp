import type { PurchaseOrder } from '../services/types';

export const ORDER_STATUS_TONE = { open: 'info', received: 'ok', cancelled: 'neutral' } as const;

/** Received, but nobody has added the supplier's bill for it yet. */
export const needsBill = (order: PurchaseOrder) => order.status === 'received' && order.bill === null;

/** The order's products in one short line: the first one, then how many more. */
export function orderSummary(order: PurchaseOrder, andMore: (first: string, n: number) => string): string {
  const quantity = (line: PurchaseOrder['lines'][number]) => (order.status === 'received' ? (line.receivedQuantity ?? 0) : line.quantity);
  const [first, ...rest] = order.lines;
  if (!first) return '';
  const label = `${quantity(first)} × ${first.productName}`;
  return rest.length === 0 ? label : andMore(label, rest.length);
}
