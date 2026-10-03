import type { Request, Response } from 'express';
import type { ActivityLogService } from '../services/ActivityLogService.js';
import type { UndoService } from '../services/undo/UndoService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { activityQuerySchema, undoBodySchema } from '../validators/activityValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createActivityController(activityLogService: ActivityLogService, undoService: UndoService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { action, ...query } = parseInput(activityQuerySchema, req.query);
      const { items, meta } = await activityLogService.list({ ...query, actions: action }, req.user!);
      sendSuccess(res, items, { meta });
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
  };
}
