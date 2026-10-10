import type { Request, Response } from 'express';
import { messages } from '../i18n/messages.js';
import type { AttentionService } from '../services/AttentionService.js';
import { sendSuccess } from '../utils/apiResponse.js';

export function createAttentionController(attentionService: AttentionService) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await attentionService.forUser(req.user!.role, messages[req.user!.language]));
    },
  };
}
