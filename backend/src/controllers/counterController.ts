import type { Request, Response } from 'express';
import type { CashCountService } from '../services/CashCountService.js';
import type { CounterService } from '../services/CounterService.js';
import type { ProductService } from '../services/ProductService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { canOversee } from '../utils/roles.js';
import { counterEventsQuerySchema, counterReceiptsQuerySchema, counterEventsSchema, counterReportSchema, counterSettingsSchema, counterShelfSchema } from '../validators/counterValidators.js';
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

    /**
     * The shelf and which of the till's held sales it already counts. The keys are read first: a sale recorded in
     * between is then in the stock but not named, so the till keeps it off once more (one unit too few until the next
     * fetch) rather than showing a sold unit again.
     * asOf: the server's clock just before the reads and just after them. The shelf has every sale finished before
     * `from` and none finished after `to`, so a till keeping two shelves knows which is surely the newer (its own
     * clock can't say: two requests can reach the server in the other order).
     */
    async shelfCounting(req: Request, res: Response): Promise<void> {
      const { held } = parseInput(counterShelfSchema, req.body);
      const from = Date.now();
      const counted = await counterService.recordedSaleKeys(held);
      const products = await productService.shelf();
      sendSuccess(res, { products, counted, asOf: { from, to: Date.now() } });
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
