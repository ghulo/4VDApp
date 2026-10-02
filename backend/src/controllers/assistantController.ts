import type { Request, Response } from 'express';
import type { AssistantService } from '../services/AssistantService.js';
import type { PriceSuggestionService } from '../services/PriceSuggestionService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { askAssistantSchema } from '../validators/reportValidators.js';
import { parseInput, productIdParamsSchema } from '../validators/validate.js';

export function createAssistantController(assistantService: AssistantService, priceSuggestionService: PriceSuggestionService) {
  return {
    async status(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, assistantService.status());
    },

    async ask(req: Request, res: Response): Promise<void> {
      const { question } = parseInput(askAssistantSchema, req.body);
      sendSuccess(res, await assistantService.ask(question));
    },

    async suggestPrice(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      sendSuccess(res, await priceSuggestionService.suggest(productId));
    },
  };
}
