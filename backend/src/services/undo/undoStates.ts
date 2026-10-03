import type { UserRole } from '../../database/types.js';
import type { ActivityRecord } from '../../repositories/ActivityLogRepository.js';
import type { UndoRepository } from '../../repositories/UndoRepository.js';
import { toMoney } from '../mappers.js';
import { changedFields } from './editReverts.js';
import { canUndo, type UndoKind, undoTargetOf } from './undoRules.js';

/** What the dashboard needs to offer Undo or Restore on one activity entry. */
export interface UndoInfo {
  /** For the person looking: can act now, already undone, blocked, or not theirs to undo. */
  state: 'undoable' | 'undone' | 'locked' | 'forbidden';
  /** Whether the viewer may undo or restore this person's entries at all (false with `forbidden`, and on undone entries they can't restore). */
  allowed: boolean;
  kind: UndoKind;
  undoneBy: { id: number; name: string } | null;
  undoneAt: string | null;
  note: string | null;
  /** Plain facts about what an undo does; the dashboard words them in its language. */
  effect: {
    stock?: { product: string; delta: number };
    money?: { amount: number; day: string };
    fields?: Array<{ field: string; from: unknown; to: unknown }>;
  };
  /** Why it can't be undone (or restored) right now. */
  lockedReason: 'linked_return' | 'not_approved' | 'from_return' | 'changed_since' | 'cannot_restore' | null;
}

interface Found {
  ownerId: number | null;
  undone: { at: Date | null; by: number | null; note: string | null };
  effect: UndoInfo['effect'];
  lockedReason: UndoInfo['lockedReason'];
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * Undo state for a page of activity entries, as the viewer sees it. One query
 * per kind for the whole page, so a long timeline stays quick.
 */
export async function undoStatesFor(
  repository: UndoRepository,
  entries: ActivityRecord[],
  viewer: { id: number; role: UserRole },
): Promise<Map<number, UndoInfo>> {
  const targets = entries.flatMap((entry) => {
    const target = undoTargetOf(entry);
    return target ? [{ entry, target }] : [];
  });
  const idsOf = (kind: UndoKind) => targets.filter(({ target }) => target.kind === kind).map(({ target }) => target.id);
  const editEntries = targets.filter(({ target }) =>
    ['product_edit', 'pricing_edit', 'settings_edit', 'reorder_edit', 'promotion'].includes(target.kind),
  );

  const [sales, returns, writeOffs, countLines, stockProducts, changedSince] = await Promise.all([
    repository.salesByIds(idsOf('sale')),
    repository.returnsByIds(idsOf('return')),
    repository.writeOffsByIds(idsOf('write_off')),
    repository.countLinesByCounts(idsOf('count_line')),
    repository.productNames(targets.filter(({ target }) => target.kind === 'stock').map(({ entry }) => entry.entity_id!)),
    // Edits are few on a page; one small query each.
    Promise.all(
      editEntries.map(async ({ entry, target }) => {
        if (target.kind === 'promotion') return [entry.id, false] as const;
        const scope =
          target.kind === 'settings_edit'
            ? { entityType: 'settings' as const, entityId: null, actions: ['settings.updated'] }
            : target.kind === 'reorder_edit'
              ? { entityType: 'product' as const, entityId: entry.entity_id, actions: ['stock.adjusted'] }
              : { entityType: 'product' as const, entityId: entry.entity_id, actions: ['product.updated', 'pricing.updated'] };
        const fields = new Set(changedFields(entry));
        const later = await repository.laterEntries(entry.id, scope);
        return [entry.id, later.some((other) => changedFields(other).some((field) => fields.has(field)))] as const;
      }),
    ).then((pairs) => new Map(pairs)),
  ]);

  const found = new Map<number, Found>();
  for (const { entry, target } of targets) {
    const own = { at: entry.undone_at, by: entry.undone_by, note: entry.undo_note };
    switch (target.kind) {
      case 'sale': {
        const sale = sales.find((row) => row.id === target.id);
        if (!sale) break;
        found.set(entry.id, {
          ownerId: sale.sold_by,
          undone: { at: sale.undone_at, by: sale.undone_by, note: sale.undo_note },
          effect: {
            stock: { product: sale.product_name, delta: sale.quantity_sold },
            money: { amount: -toMoney(sale.total_amount), day: sale.sale_date.toISOString() },
          },
          lockedReason: Number(sale.standing_returns) > 0 ? 'linked_return' : null,
        });
        break;
      }
      case 'return': {
        const item = returns.find((row) => row.id === target.id);
        if (!item) break;
        found.set(entry.id, {
          ownerId: item.requested_by,
          undone: { at: item.undone_at, by: item.undone_by, note: item.undo_note },
          effect: {
            ...(item.condition === 'resellable' && { stock: { product: item.product_name, delta: -item.quantity } }),
            ...(item.decided_at && { money: { amount: roundMoney(toMoney(item.refund_amount)), day: item.decided_at.toISOString() } }),
          },
          lockedReason: item.status === 'approved' ? null : 'not_approved',
        });
        break;
      }
      case 'write_off': {
        const writeOff = writeOffs.find((row) => row.id === target.id);
        if (!writeOff) break;
        found.set(entry.id, {
          ownerId: writeOff.requested_by,
          undone: { at: writeOff.undone_at, by: writeOff.undone_by, note: writeOff.undo_note },
          effect: { stock: { product: writeOff.product_name, delta: writeOff.quantity } },
          lockedReason: writeOff.return_id !== null ? 'from_return' : writeOff.status === 'approved' ? null : 'not_approved',
        });
        break;
      }
      case 'count_line': {
        const line = countLines.find((row) => row.count_id === target.id && row.product_id === target.productId);
        if (!line) break;
        found.set(entry.id, {
          ownerId: line.submitted_by,
          undone: { at: line.undone_at, by: line.undone_by, note: line.undo_note },
          effect: { stock: { product: line.product_name, delta: -(line.counted_quantity - line.expected_quantity) } },
          lockedReason: line.status === 'approved' ? null : 'not_approved',
        });
        break;
      }
      case 'stock': {
        const product = stockProducts.find((row) => row.id === entry.entity_id);
        found.set(entry.id, {
          ownerId: entry.user_id,
          undone: own,
          effect: { stock: { product: product?.name ?? '', delta: -Number(entry.details?.quantity) } },
          lockedReason: null,
        });
        break;
      }
      default: {
        const details = entry.details ?? {};
        const fields =
          entry.action === 'pricing.updated'
            ? [{ field: 'bulkPricingTiers', from: details.to, to: details.from }]
            : changedFields(entry).map((field) => {
                const change = details[field] as { from: unknown; to: unknown };
                return { field, from: change.to, to: change.from };
              });
        found.set(entry.id, {
          ownerId: entry.user_id,
          undone: own,
          effect: fields.length > 0 ? { fields } : {},
          lockedReason: changedSince.get(entry.id)
            ? 'changed_since'
            : target.kind === 'promotion' && own.at
              ? 'cannot_restore'
              : null,
        });
      }
    }
  }

  const people = new Map(
    (
      await repository.usersByIds([
        ...new Set([...found.values()].flatMap((item) => [item.ownerId, item.undone.by]).filter((id): id is number => id !== null)),
      ])
    ).map((user) => [user.id, user]),
  );

  const states = new Map<number, UndoInfo>();
  for (const { entry, target } of targets) {
    const item = found.get(entry.id);
    if (!item) continue;
    const owner = item.ownerId === null ? undefined : people.get(item.ownerId);
    const allowed = canUndo(viewer, owner ? { id: owner.id, role: owner.role } : null);
    const undoneBy = item.undone.by === null ? undefined : people.get(item.undone.by);
    const state: UndoInfo['state'] = item.undone.at ? 'undone' : !allowed ? 'forbidden' : item.lockedReason ? 'locked' : 'undoable';
    states.set(entry.id, {
      state,
      allowed,
      kind: target.kind,
      undoneBy: undoneBy ? { id: undoneBy.id, name: undoneBy.name } : null,
      undoneAt: item.undone.at?.toISOString() ?? null,
      note: item.undone.note,
      effect: item.effect,
      lockedReason: item.lockedReason,
    });
  }
  return states;
}
