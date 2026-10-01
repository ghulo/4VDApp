import type { Request, Response } from 'express';
import type { ActivityLogService } from '../services/ActivityLogService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { activityQuerySchema } from '../validators/activityValidators.js';
import { parseInput } from '../validators/validate.js';

export function createActivityController(activityLogService: ActivityLogService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { action, ...query } = parseInput(activityQuerySchema, req.query);
      const { items, meta } = await activityLogService.list({ ...query, actions: action });
      sendSuccess(res, items, { meta });
    },
  };
}
