import type { Request, Response } from 'express';
import type { WriteOffService } from '../services/WriteOffService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { approvalListQuerySchema, decisionNoteSchema, writeOffSchema } from '../validators/approvalValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createWriteOffsController(writeOffService: WriteOffService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await writeOffService.list(parseInput(approvalListQuerySchema, req.query)));
    },

    async request(req: Request, res: Response): Promise<void> {
      const writeOff = await writeOffService.request(parseInput(writeOffSchema, req.body), req.user!);
      const message = writeOff.status === 'pending' ? 'Sent for approval' : 'Written off';
      sendSuccess(res, writeOff, { statusCode: 201, message });
    },

    async approve(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await writeOffService.approve(id, req.user!), { message: 'Approved' });
    },

    async reject(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { note } = parseInput(decisionNoteSchema, req.body);
      sendSuccess(res, await writeOffService.reject(id, req.user!, note), { message: 'Rejected' });
    },
  };
}
