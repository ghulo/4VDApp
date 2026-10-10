import type { Request, Response } from 'express';
import type { AssistantService } from '../services/AssistantService.js';
import type { PriceSuggestionService } from '../services/PriceSuggestionService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { askAssistantSchema } from '../validators/reportValidators.js';
import { idParamsSchema, parseInput, productIdParamsSchema } from '../validators/validate.js';

export function createAssistantController(assistantService: AssistantService, priceSuggestionService: PriceSuggestionService) {
  return {
    async status(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, assistantService.status());
    },

    async chats(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await assistantService.chats(req.user!.id));
    },

    async chat(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await assistantService.chat(req.user!.id, id));
    },

    async ask(req: Request, res: Response): Promise<void> {
      const { question, chatId } = parseInput(askAssistantSchema, req.body);
      sendSuccess(res, await assistantService.ask(req.user!.id, question, chatId));
    },

    async deleteChat(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await assistantService.deleteChat(req.user!.id, id);
      sendSuccess(res, null, { message: 'Chat deleted' });
    },

    async suggestPrice(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      sendSuccess(res, await priceSuggestionService.suggest(productId));
    },
  };
}
