import type { Request, Response } from 'express';
import type { ApprovalService } from '../services/ApprovalService.js';
import { sendSuccess } from '../utils/apiResponse.js';

export function createApprovalsController(approvalService: ApprovalService) {
  return {
    async summary(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await approvalService.summary());
    },

    async mine(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await approvalService.mine(req.user!.id));
    },
  };
}
