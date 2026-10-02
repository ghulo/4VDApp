import type { Request, Response } from 'express';
import type { AssistantService } from '../services/AssistantService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { askAssistantSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

export function createAssistantController(assistantService: AssistantService) {
  return {
    async status(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, assistantService.status());
    },

    async ask(req: Request, res: Response): Promise<void> {
      const { question } = parseInput(askAssistantSchema, req.body);
      sendSuccess(res, await assistantService.ask(question));
    },
  };
}
