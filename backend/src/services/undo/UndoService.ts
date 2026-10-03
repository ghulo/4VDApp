import { NOTIFICATION_TYPES } from '../../constants/notifications.js';
import { SYSTEM_STOCK_REASONS } from '../../constants/stock.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/httpErrors.js';
import type { UndoneKind } from '../../i18n/messages.js';
import type { TransactionalRepositories, TransactionManager } from '../../repositories/TransactionManager.js';
import type { UndoRepository, UndoRow, UndoState } from '../../repositories/UndoRepository.js';
import type { PublicUser } from '../../types/auth.js';
import { applyStockChange } from '../InventoryService.js';
import type { EditReverts } from './editReverts.js';
import { canUndo, type UndoTarget, undoTargetOf } from './undoRules.js';

type Mode = 'undo' | 'restore';

/** What undoing one entry means, worked out while its row is locked. */
interface UndoPlan {
  kind: UndoneKind;
  /** The person whose action it was; null when they've been removed. */
  ownerId: number | null;
  state: UndoState;
  /** Rows marked undone together: the target first, then any that follow it. */
  rows: UndoRow[];
  /** Read by people, e.g. "3 × Oak Chair". */
  what: string;
  /** For stock notes, e.g. "sale #12". */
  label: string;
  /** Stock change an undo applies; a restore applies the opposite. Null when stock isn't touched. */
  stock: { productId: number; delta: number } | null;
  /** Kind-specific refusals, checked after the hierarchy and the undone state. */
  check?: (mode: Mode) => Promise<void>;
}

/** Kinds whose undo puts old values back through the edit services (see editReverts). */
const EDIT_KINDS = new Set<UndoTarget['kind']>(['product_edit', 'pricing_edit', 'settings_edit', 'reorder_edit', 'promotion']);

/**
 * Undo and restore what a person did, keyed by their activity log entry.
 * Nothing is deleted: the row is marked undone (or cleared on restore), stock
 * is moved back through the normal path, and both steps are logged and the
 * person is told. Money reports leave undone rows out on the day they happened.
 */
export class UndoService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly undoRepository: UndoRepository,
    private readonly edits: EditReverts,
  ) {}

  undo(entryId: number, actor: PublicUser, note: string | null): Promise<void> {
    return this.run(entryId, actor, 'undo', note);
  }

  restore(entryId: number, actor: PublicUser): Promise<void> {
    return this.run(entryId, actor, 'restore', null);
  }

  private async run(entryId: number, actor: PublicUser, mode: Mode, note: string | null): Promise<void> {
    const entry = await this.undoRepository.findEntry(entryId);
    if (!entry) throw new NotFoundError(`Activity entry ${entryId} does not exist`);
    const target = undoTargetOf(entry);
    if (!target) throw new NotFoundError("This entry can't be undone");
    if (EDIT_KINDS.has(target.kind)) return this.runEdit(entry, target, actor, mode, note);

    await this.transactions.run(async (repos) => {
      const plan = await planFor(repos, target, entry);
      await assertAllowed(repos, actor, plan.ownerId, plan.state, mode);
      await plan.check?.(mode);

      const effect = plan.stock ? await moveStock(repos, plan, mode, actor.id) : null;
      for (const row of plan.rows) await repos.undo.mark(row, mode === 'undo' ? { by: actor.id, note } : null);
      await logAndTell(repos, { entry, target, actor, mode, note, effect, ownerId: plan.ownerId, kind: plan.kind, what: plan.what });
    });
  }

  /**
   * Edits go through their own services (each with its own transaction), so
   * the entry is claimed first: marked while locked, so a second click is
   * refused, and put back as it was if applying the old values fails.
   */
  private async runEdit(entry: Entry, target: UndoTarget, actor: PublicUser, mode: Mode, note: string | null): Promise<void> {
    const row: UndoRow = { table: 'activity_log', id: entry.id };
    const before = await this.transactions.run(async (repos) => {
      const locked = await repos.undo.lockEntry(entry.id);
      if (!locked) throw new NotFoundError(`Activity entry ${entry.id} does not exist`);
      await assertAllowed(repos, actor, locked.user_id, locked, mode);
      await this.edits.check(target, entry, mode);
      await repos.undo.mark(row, mode === 'undo' ? { by: actor.id, note } : null);
      return locked;
    });

    let result: Awaited<ReturnType<EditReverts['apply']>>;
    try {
      result = await this.edits.apply(target, entry, mode, actor);
    } catch (error) {
      const previous =
        before.undone_at && before.undone_by !== null ? { by: before.undone_by, note: before.undo_note, at: before.undone_at } : null;
      await this.undoRepository.mark(row, previous);
      throw error;
    }

    await this.transactions.run((repos) =>
      logAndTell(repos, {
        entry,
        target,
        actor,
        mode,
        note,
        effect: { fields: result.fields },
        ownerId: before.user_id,
        kind: target.kind === 'settings_edit' ? 'settings' : 'edit',
        what: result.what,
      }),
    );
  }
}

type Entry = NonNullable<Awaited<ReturnType<UndoRepository['findEntry']>>>;

/** The hierarchy, then whether it is in the right state to undo or restore. */
async function assertAllowed(repos: TransactionalRepositories, actor: PublicUser, ownerId: number | null, state: UndoState, mode: Mode) {
  const owner = ownerId === null ? undefined : await repos.users.findById(ownerId);
  if (!canUndo(actor, owner ? { id: owner.id, role: owner.role } : null)) {
    throw new ForbiddenError("You're not allowed to undo this person's actions");
  }
  if (mode === 'undo' && state.undone_at) {
    const by = state.undone_by === null ? undefined : await repos.users.findById(state.undone_by);
    throw new ConflictError(`This was already undone${by ? ` by ${by.name}` : ''}`);
  }
  if (mode === 'restore' && !state.undone_at) throw new ConflictError("This isn't undone, so there is nothing to restore");
}

/** Log the undo or restore against the original entry, and tell the person whose entry it was. */
async function logAndTell(
  repos: TransactionalRepositories,
  p: {
    entry: Entry;
    target: UndoTarget;
    actor: PublicUser;
    mode: Mode;
    note: string | null;
    effect: unknown;
    ownerId: number | null;
    kind: UndoneKind;
    /** Null for settings: the alert names them in the reader's language. */
    what: string | null;
  },
) {
  await repos.activityLog.create({
    userId: p.actor.id,
    action: p.mode === 'undo' ? 'undo.applied' : 'undo.restored',
    entityType: 'activity',
    entityId: p.entry.id,
    summary: `${p.mode === 'undo' ? 'Undid' : 'Restored'}: ${p.entry.summary}`,
    details: { entryId: p.entry.id, kind: p.target.kind, targetId: p.target.id, note: p.note, effect: p.effect },
  });
  if (p.ownerId === null || p.ownerId === p.actor.id) return;
  await repos.notifications.createForUser(p.ownerId, {
    type: NOTIFICATION_TYPES.UNDONE,
    write: (t) => {
      const what = p.what ?? t.settingsWhat;
      return p.mode === 'undo'
        ? { title: t.undoneTitle(p.kind, what), message: t.undoneMessage(p.note) }
        : { title: t.restoredTitle(p.kind, what), message: t.restoredMessage };
    },
  });
}

/** Lock the target row and work out what undoing it means. Must run in a transaction. */
async function planFor(
  repos: TransactionalRepositories,
  target: UndoTarget,
  entry: { id: number; entity_id: number | null; summary: string },
): Promise<UndoPlan> {
  switch (target.kind) {
    case 'sale': {
      const sale = await repos.undo.lockSale(target.id);
      if (!sale) throw new NotFoundError(`Sale ${target.id} does not exist`);
      return {
        kind: 'sale',
        ownerId: sale.sold_by,
        state: sale,
        rows: [{ table: 'sales', id: sale.id }],
        what: `${sale.quantity_sold} × ${sale.product_name}`,
        label: `sale #${sale.id}`,
        stock: { productId: sale.product_id, delta: sale.quantity_sold },
        check: async (mode) => {
          if (mode === 'undo' && (await repos.undo.standingReturns(sale.id)) > 0) {
            throw new ConflictError('This sale has a return waiting or approved. Undo the return first.');
          }
        },
      };
    }
    case 'return': {
      const item = await repos.undo.lockReturn(target.id);
      if (!item) throw new NotFoundError(`Return ${target.id} does not exist`);
      if (item.status !== 'approved') throw new ConflictError(`This return is ${item.status}; only an approved return can be undone`);
      // A damaged return never put units back; its write-off is undone with it instead.
      const writeOffId = item.condition === 'damaged' ? await repos.undo.writeOffOfReturn(item.id) : undefined;
      return {
        kind: 'return',
        ownerId: item.requested_by,
        state: item,
        rows: [{ table: 'returns', id: item.id }, ...(writeOffId ? [{ table: 'write_offs' as const, id: writeOffId }] : [])],
        what: `${item.quantity} × ${item.product_name}`,
        label: `return #${item.id}`,
        stock: item.condition === 'resellable' ? { productId: item.product_id, delta: -item.quantity } : null,
        check: async (mode) => {
          if (mode !== 'restore') return;
          const sale = await repos.returns.lockSale(item.sale_id);
          if (!sale) throw new NotFoundError(`Sale ${item.sale_id} does not exist`);
          if (sale.undone_at) throw new ConflictError('The sale was undone. Restore the sale first.');
          const left = sale.quantity_sold - sale.returned_quantity;
          if (item.quantity > left) throw new ConflictError(`Only ${left} left to return from this sale`);
        },
      };
    }
    case 'write_off': {
      const writeOff = await repos.undo.lockWriteOff(target.id);
      if (!writeOff) throw new NotFoundError(`Write-off ${target.id} does not exist`);
      if (writeOff.return_id !== null) throw new ConflictError('This write-off came from a return. Undo the return instead.');
      if (writeOff.status !== 'approved') {
        throw new ConflictError(`This write-off is ${writeOff.status}; only an approved write-off can be undone`);
      }
      return {
        kind: 'write_off',
        ownerId: writeOff.requested_by,
        state: writeOff,
        rows: [{ table: 'write_offs', id: writeOff.id }],
        what: `${writeOff.quantity} × ${writeOff.product_name}`,
        label: `write-off #${writeOff.id}`,
        stock: { productId: writeOff.product_id, delta: writeOff.quantity },
      };
    }
    case 'count_line': {
      const productId = target.productId!;
      const line = await repos.undo.lockCountLine(target.id, productId);
      if (!line) throw new NotFoundError('That product was not counted in this count');
      if (line.status !== 'approved') throw new ConflictError('Only an approved count correction can be undone');
      return {
        kind: 'count_line',
        ownerId: line.submitted_by,
        state: line,
        rows: [{ table: 'stock_count_lines', countId: target.id, productId }],
        what: line.product_name,
        label: `count #${target.id}`,
        stock: { productId, delta: -(line.counted_quantity - line.expected_quantity) },
      };
    }
    case 'stock': {
      const locked = await repos.undo.lockEntry(entry.id);
      if (!locked || locked.entity_id === null) throw new NotFoundError("This entry can't be undone");
      const quantity = Number(locked.details?.quantity);
      const product = await repos.products.findById(locked.entity_id, true);
      return {
        kind: 'stock',
        ownerId: locked.user_id,
        state: locked,
        rows: [{ table: 'activity_log', id: locked.id }],
        what: `${quantity > 0 ? '+' : ''}${quantity} × ${product?.name ?? `product #${locked.entity_id}`}`,
        label: `stock change (log entry #${locked.id})`,
        stock: { productId: locked.entity_id, delta: -quantity },
      };
    }
    default:
      throw new NotFoundError("This entry can't be undone");
  }
}

/** Move the stock back (or forward again on restore). Never below zero. */
async function moveStock(repos: TransactionalRepositories, plan: UndoPlan, mode: Mode, actorId: number) {
  const { productId } = plan.stock!;
  const delta = mode === 'undo' ? plan.stock!.delta : -plan.stock!.delta;
  if (delta === 0) return { productId, stockChange: 0 };
  const product = await repos.products.findById(productId, true);
  if (!product) throw new ConflictError("This product was deleted, so its stock can't be changed back");
  try {
    const { before, after } = await applyStockChange(repos, {
      productId,
      productName: product.name,
      delta,
      reason: mode === 'undo' ? SYSTEM_STOCK_REASONS.UNDO : SYSTEM_STOCK_REASONS.RESTORE,
      notes: `${mode === 'undo' ? 'Undo' : 'Restore'} of ${plan.label}`,
      adjustedBy: actorId,
      reorderLevel: product.reorder_level ?? 0,
    });
    return { productId, stockChange: delta, before, after };
  } catch (error) {
    if (error instanceof ValidationError) throw new ConflictError(`Only ${product.quantity_on_hand} left in stock`);
    throw error;
  }
}
