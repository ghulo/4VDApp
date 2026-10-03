import { describe, expect, it } from 'vitest';
import { canUndo, undoTargetOf } from '../src/services/undo/undoRules.js';

const as = (id: number, role: 'developer' | 'admin' | 'owner' | 'employee' | 'family') => ({ id, role });

describe('canUndo', () => {
  it('should let the developer undo anyone', () => {
    for (const role of ['developer', 'admin', 'owner', 'employee'] as const) expect(canUndo(as(1, 'developer'), as(2, role))).toBe(true);
  });

  it('should let admins and the owner undo employees and themselves only', () => {
    expect(canUndo(as(1, 'admin'), as(2, 'employee'))).toBe(true);
    expect(canUndo(as(1, 'owner'), as(1, 'owner'))).toBe(true);
    expect(canUndo(as(1, 'admin'), as(2, 'owner'))).toBe(false);
    expect(canUndo(as(1, 'owner'), as(2, 'admin'))).toBe(false);
    expect(canUndo(as(1, 'admin'), as(2, 'developer'))).toBe(false);
  });

  it('should let employees and family undo nothing', () => {
    expect(canUndo(as(1, 'employee'), as(1, 'employee'))).toBe(false);
    expect(canUndo(as(1, 'family'), as(2, 'employee'))).toBe(false);
  });

  it('should let only the developer undo entries whose person was removed', () => {
    expect(canUndo(as(1, 'developer'), null)).toBe(true);
    expect(canUndo(as(1, 'admin'), null)).toBe(false);
  });
});

describe('undoTargetOf', () => {
  const entry = (action: string, details: Record<string, unknown> | null = null) => ({ id: 9, action, entity_id: 4, details });

  it('should map each undoable entry to what it changed', () => {
    expect(undoTargetOf(entry('sale.recorded'))).toEqual({ kind: 'sale', id: 4 });
    expect(undoTargetOf(entry('return.approved'))).toEqual({ kind: 'return', id: 4 });
    expect(undoTargetOf(entry('write_off.requested'))).toEqual({ kind: 'write_off', id: 4 });
    expect(undoTargetOf(entry('count.line_approved', { productId: 7 }))).toEqual({ kind: 'count_line', id: 4, productId: 7 });
    expect(undoTargetOf(entry('stock.adjusted', { quantity: 3 }))).toEqual({ kind: 'stock', id: 9 });
    expect(undoTargetOf(entry('stock.adjusted', { reorderLevel: { from: 5, to: 8 } }))).toEqual({ kind: 'reorder_edit', id: 9 });
    expect(undoTargetOf(entry('product.updated'))).toEqual({ kind: 'product_edit', id: 9 });
    expect(undoTargetOf(entry('pricing.updated'))).toEqual({ kind: 'pricing_edit', id: 9 });
    expect(undoTargetOf(entry('settings.updated'))).toEqual({ kind: 'settings_edit', id: 9 });
    expect(undoTargetOf(entry('promotion.created'))).toEqual({ kind: 'promotion', id: 4 });
  });

  it('should give nothing for entries that cannot be undone', () => {
    for (const action of ['auth.logged_in', 'product.deleted', 'user.created', 'return.rejected', 'count.started', 'undo.applied']) {
      expect(undoTargetOf(entry(action))).toBeNull();
    }
  });
  it('should give nothing for an undo’s own change', () => {
    expect(undoTargetOf(entry('product.updated', { price: { from: 79, to: 89 }, undoOf: 3 }))).toBeNull();
  });
});
