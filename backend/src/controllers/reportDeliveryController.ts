import type { Request, Response } from 'express';
import type { ReportDeliveryService } from '../services/reports/ReportDeliveryService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { fullReportQuerySchema, reportSettingsSchema, sendTestReportSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

/** The full daily and weekly reports: reading one, choosing what comes, and a test send. */
export function createReportDeliveryController(reports: ReportDeliveryService) {
  return {
    async full(req: Request, res: Response): Promise<void> {
      const { kind, from } = parseInput(fullReportQuerySchema, req.query);
      sendSuccess(res, await reports.view(req.user!.id, req.user!.language, kind, from));
    },

    async settings(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reports.settings(req.user!.id));
    },

    async saveSettings(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reports.saveSettings(req.user!.id, parseInput(reportSettingsSchema, req.body)), { message: 'Report settings saved' });
    },

    async sendTest(req: Request, res: Response): Promise<void> {
      const { kind } = parseInput(sendTestReportSchema, req.body);
      await reports.sendTest(req.user!.id, kind);
      sendSuccess(res, null, { message: 'Report sent' });
    },
  };
}
