import { describe, expect, it } from 'vitest';
import { getStockAlert } from '../src/services/inventory/stockAlerts.js';

const change = (before: number, after: number, reorderLevel = 10) => ({
  productName: 'Oak Chair',
  before,
  after,
  reorderLevel,
});

describe('getStockAlert', () => {
  it('should alert when stock drops to the reorder level', () => {
    expect(getStockAlert(change(12, 10))?.type).toBe('low_stock');
  });

  it('should not alert again while stock stays low', () => {
    expect(getStockAlert(change(8, 5))).toBeNull();
  });

  it('should alert when stock runs out, even if it was already low', () => {
    expect(getStockAlert(change(3, 0))?.type).toBe('out_of_stock');
  });

  it('should not alert when stock goes up', () => {
    expect(getStockAlert(change(2, 50))).toBeNull();
  });

  it('should not alert when stock stays above the reorder level', () => {
    expect(getStockAlert(change(50, 40))).toBeNull();
  });

  it('should include the remaining quantity in the message', () => {
    expect(getStockAlert(change(15, 4))?.message).toContain('Only 4 left');
  });
});
