import type { Request, Response } from 'express';
import type { SettingsService } from '../services/SettingsService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { updateSettingsSchema } from '../validators/approvalValidators.js';
import { parseInput } from '../validators/validate.js';

export function createSettingsController(settingsService: SettingsService) {
  return {
    async get(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await settingsService.get());
    },

    async update(req: Request, res: Response): Promise<void> {
      const input = parseInput(updateSettingsSchema, req.body);
      sendSuccess(res, await settingsService.update(input, req.user!.id), { message: 'Settings saved' });
    },
  };
}
