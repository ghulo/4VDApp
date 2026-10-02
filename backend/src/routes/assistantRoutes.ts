import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMITS } from '../constants/rateLimits.js';
import type { Container } from '../container.js';
import { createAssistantController } from '../controllers/assistantController.js';

export function createAssistantRoutes({ assistantService, priceSuggestionService, guards }: Container): Router {
  const controller = createAssistantController(assistantService, priceSuggestionService);
  const router = Router();
  const questionLimit = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMITS.AI_QUESTIONS,
    keyGenerator: (req) => `ai:${req.user!.id}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, data: null, message: 'That is a lot of questions. Try again in a few minutes.', error: 'RATE_LIMITED' },
  });

  router.use(...guards.admin);
  router.get('/', controller.status);
  router.post('/ask', questionLimit, controller.ask);
  router.post('/price-suggestions/:productId', questionLimit, controller.suggestPrice);

  return router;
}
