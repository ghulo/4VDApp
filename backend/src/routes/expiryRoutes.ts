import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { calendarDaySchema, idParamsSchema, idSchema, parseInput } from '../validators/validate.js';

const newExpirySchema = z.object({
  productId: idSchema,
  quantity: z.number().int().min(1).max(100_000),
  expiresOn: calendarDaySchema,
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
});

export function createExpiryRoutes({ expiryService, guards }: Container): Router {
  const router = Router();

  // Staff note dates while stocking shelves; everyone who sees stock sees them.
  router.get('/', guards.authenticated, async (req: Request, res: Response) => {
    const { productId } = parseInput(z.object({ productId: idSchema.optional() }), req.query);
    sendSuccess(res, productId ? await expiryService.forProduct(productId) : await expiryService.upcoming());
  });
  router.post('/', ...guards.staff, async (req: Request, res: Response) => {
    sendSuccess(res, await expiryService.add(parseInput(newExpirySchema, req.body), req.user!.id), { statusCode: 201 });
  });
  router.post('/:id/clear', ...guards.staff, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    await expiryService.clear(id, req.user!.id);
    sendSuccess(res, null, { message: 'Marked as dealt with' });
  });

  return router;
}
