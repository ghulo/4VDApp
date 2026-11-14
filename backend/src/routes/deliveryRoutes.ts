import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { calendarDaySchema, idParamsSchema, parseInput } from '../validators/validate.js';

const deliveredSchema = z.object({ collected: z.number().min(0).max(10_000_000).multipleOf(0.01) });
const missedSchema = z.object({
  reason: z.string().trim().min(1, 'say why').max(300),
  day: calendarDaySchema.nullish().transform((value) => value ?? null),
});
const customerSchema = z.object({ customerId: z.coerce.number().int().positive() });

/** Sales taken to the customer's door: everyone at the counter sees, takes and delivers them. */
export function createDeliveryRoutes({ salesDocumentService, guards }: Container): Router {
  const router = Router();

  router.get('/', ...guards.staff, async (_req: Request, res: Response) => {
    sendSuccess(res, await salesDocumentService.deliveries());
  });
  router.get('/last-address', ...guards.staff, async (req: Request, res: Response) => {
    const { customerId } = parseInput(customerSchema, req.query);
    sendSuccess(res, (await salesDocumentService.lastAddress(customerId)) ?? null);
  });
  router.post('/:id/take', ...guards.staff, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await salesDocumentService.take(id, req.user!), { message: 'On its way' });
  });
  router.post('/:id/delivered', ...guards.staff, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const { collected } = parseInput(deliveredSchema, req.body);
    sendSuccess(res, await salesDocumentService.deliver(id, req.user!, collected), { message: 'Delivered' });
  });
  router.post('/:id/missed', ...guards.staff, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await salesDocumentService.missed(id, req.user!, parseInput(missedSchema, req.body)), { message: 'Back on the list' });
  });

  return router;
}
