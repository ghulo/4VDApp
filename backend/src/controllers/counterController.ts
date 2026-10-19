import type { Request, Response } from 'express';
import type { CashCountService } from '../services/CashCountService.js';
import type { CounterService } from '../services/CounterService.js';
import type { ProductService } from '../services/ProductService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { canOversee } from '../utils/roles.js';
import { counterEventsQuerySchema, counterReceiptsQuerySchema, counterEventsSchema, counterReportSchema, counterSettingsSchema } from '../validators/counterValidators.js';
import { parseInput } from '../validators/validate.js';

export function createCounterController(counterService: CounterService, productService: ProductService, cashCountService: CashCountService) {
  return {
    async settings(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.settings());
    },

    async updateSettings(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.updateSettings(parseInput(counterSettingsSchema, req.body), req.user!.id), { message: 'Counter settings saved' });
    },

    async record(req: Request, res: Response): Promise<void> {
      await counterService.record(parseInput(counterEventsSchema, req.body).events, req.user!.id);
      sendSuccess(res, null, { statusCode: 201 });
    },

    async shelf(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await productService.shelf());
    },

    async today(req: Request, res: Response): Promise<void> {
      const user = req.user!;
      // Only the people who check the money see what the drawer should hold: staff count blind.
      const [today, drawer] = await Promise.all([counterService.today(user.id), canOversee(user.role) ? cashCountService.shopDrawerNow() : null]);
      sendSuccess(res, { ...today, drawer });
    },

    async receipts(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.receipts(parseInput(counterReceiptsQuerySchema, req.query)));
    },

    async people(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.people(parseInput(counterReportSchema, req.query)));
    },

    async events(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.events(parseInput(counterEventsQuerySchema, req.query)));
    },
  };
}
