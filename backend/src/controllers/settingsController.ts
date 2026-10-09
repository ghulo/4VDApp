import type { Request, Response } from 'express';
import type { LaunchService } from '../services/LaunchService.js';
import type { SettingsService } from '../services/SettingsService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { updateSettingsSchema, wipeSchema } from '../validators/approvalValidators.js';
import { parseInput } from '../validators/validate.js';

export function createSettingsController(settingsService: SettingsService, launchService: LaunchService) {
  return {
    async get(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await settingsService.get());
    },

    async update(req: Request, res: Response): Promise<void> {
      const input = parseInput(updateSettingsSchema, req.body);
      sendSuccess(res, await settingsService.update(input, req.user!.id), { message: 'Settings saved' });
    },

    async launchChecklist(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await launchService.checklist());
    },

    /** Emails the signed-in developer, so they can see real email work. */
    async testEmail(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await launchService.testEmail(req.user!.email));
    },

    async wipePreview(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await launchService.wipePreview());
    },

    async wipe(req: Request, res: Response): Promise<void> {
      parseInput(wipeSchema, req.body);
      sendSuccess(res, await launchService.wipe(req.user!.id), { message: 'All test data wiped' });
    },
  };
}
