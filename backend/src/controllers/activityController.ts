import type { Request, Response } from 'express';
import type { ActivityLogService } from '../services/ActivityLogService.js';
import type { RecordRestoreService } from '../services/undo/RecordRestoreService.js';
import type { UndoService } from '../services/undo/UndoService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { activityQuerySchema, historyQuerySchema, restorePointBodySchema, undoBodySchema } from '../validators/activityValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createActivityController(activityLogService: ActivityLogService, undoService: UndoService, recordRestoreService: RecordRestoreService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { action, exclude, ...query } = parseInput(activityQuerySchema, req.query);
      const { items, meta } = await activityLogService.list({ ...query, actions: action, excludeActions: exclude }, req.user!);
      sendSuccess(res, items, { meta });
    },

    async history(req: Request, res: Response): Promise<void> {
      const { entityType, entityId } = parseInput(historyQuerySchema, req.query);
      sendSuccess(res, await activityLogService.history(entityType, entityId, req.user!));
    },

    /** Undo what an entry did; answers with the entry, now undone. */
    async undo(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { note } = parseInput(undoBodySchema, req.body ?? {});
      await undoService.undo(id, req.user!, note || null);
      sendSuccess(res, await activityLogService.get(id, req.user!), { message: 'Undone' });
    },

    async restore(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await undoService.restore(id, req.user!);
      sendSuccess(res, await activityLogService.get(id, req.user!), { message: 'Restored' });
    },

    /** What putting the record back to this entry would change. */
    async restorePlan(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await recordRestoreService.plan(id, req.user!));
    },

    /** Put the record back to how it was right after this entry. */
    async restoreTo(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { latestEntryId } = parseInput(restorePointBodySchema, req.body ?? {});
      sendSuccess(res, await recordRestoreService.apply(id, latestEntryId, req.user!), { message: 'Restored' });
    },
  };
}
