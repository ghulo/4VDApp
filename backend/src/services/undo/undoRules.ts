import type { UserRole } from '../../database/types.js';

/** What an undoable activity entry changed. */
export type UndoKind =
  | 'sale'
  | 'return'
  | 'write_off'
  | 'count_line'
  | 'stock'
  | 'product_edit'
  | 'pricing_edit'
  | 'settings_edit'
  | 'reorder_edit'
  | 'promotion';

interface Person {
  id: number;
  role: UserRole;
}

/**
 * The hierarchy: the developer may undo anyone; the owner and admins may undo
 * employees and themselves; nobody else may undo anything. `owner` is the
 * person whose action it was (null when they've been removed: developer only).
 */
export function canUndo(actor: Person, owner: Person | null): boolean {
  if (actor.role === 'developer') return true;
  if (actor.role !== 'admin' && actor.role !== 'owner') return false;
  if (owner === null) return false;
  return owner.id === actor.id || owner.role === 'employee';
}

export interface UndoTarget {
  kind: UndoKind;
  /** The row it changed (sale, return, write-off, count, promotion), or the log entry itself for stock changes and edits. */
  id: number;
  /** For a count line: which product of the count. */
  productId?: number;
}

/** What an activity entry changed, if it can be undone or reverted. */
export function undoTargetOf(entry: {
  id: number;
  action: string;
  entity_id: number | null;
  details: Record<string, unknown> | null;
}): UndoTarget | null {
  const entity = entry.entity_id;
  switch (entry.action) {
    case 'sale.recorded':
      return entity === null ? null : { kind: 'sale', id: entity };
    case 'return.requested':
    case 'return.approved':
      return entity === null ? null : { kind: 'return', id: entity };
    case 'write_off.requested':
    case 'write_off.approved':
      return entity === null ? null : { kind: 'write_off', id: entity };
    case 'count.line_approved': {
      const productId = Number(entry.details?.productId);
      return entity === null || !productId ? null : { kind: 'count_line', id: entity, productId };
    }
    case 'stock.adjusted':
      if (entry.details && 'reorderLevel' in entry.details) return { kind: 'reorder_edit', id: entry.id };
      return entry.details && 'quantity' in entry.details ? { kind: 'stock', id: entry.id } : null;
    case 'product.updated':
      return { kind: 'product_edit', id: entry.id };
    case 'pricing.updated':
      return { kind: 'pricing_edit', id: entry.id };
    case 'settings.updated':
      return { kind: 'settings_edit', id: entry.id };
    case 'promotion.created':
      return entity === null ? null : { kind: 'promotion', id: entity };
    default:
      return null;
  }
}
