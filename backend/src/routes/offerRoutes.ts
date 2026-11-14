import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { Container } from '../container.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { calendarDaySchema, idParamsSchema, idSchema, paginationSchema, parseInput, quantitySchema } from '../validators/validate.js';

const listSchema = paginationSchema.extend({ search: z.string().trim().max(100).optional() });
const mineSchema = listSchema.extend({ status: z.enum(['open', 'sold', 'declined']).optional() });

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const offerSchema = z
  .object({
    customerId: idSchema.nullish().transform((value) => value ?? null),
    partyName: text(200),
    partyPhone: text(40),
    note: text(1000),
    validUntil: calendarDaySchema.nullish().transform((value) => value ?? null),
    lines: z
      .array(z.object({ productId: idSchema, quantity: quantitySchema(1_000_000), unitPrice: z.number().min(0).max(10_000_000).multipleOf(0.01) }))
      .min(1, 'add at least one product')
      .max(200),
  })
  .refine((offer) => offer.customerId !== null || offer.partyName !== null, { path: ['partyName'], message: 'pick a customer or type who it is for' });

/**
 * Offers (price quotes). Made in 4VD: the owner's side makes and turns them
 * down (the accountant sees them); the counter opens one to sell it. TREFIN's are under /history, look-only.
 */
export function createOfferRoutes({ offerService, salesDocumentService, guards }: Container): Router {
  const router = Router();

  router.get('/', ...guards.books, async (req: Request, res: Response) => {
    const { search, ...query } = parseInput(mineSchema, req.query);
    const { items, meta } = await salesDocumentService.listOffers({ ...query, search: search || undefined });
    sendSuccess(res, items, { meta });
  });
  router.post('/', ...guards.oversee, async (req: Request, res: Response) => {
    sendSuccess(res, await salesDocumentService.createOffer(parseInput(offerSchema, req.body), req.user!.id), { statusCode: 201, message: 'Offer made' });
  });

  router.get('/history', ...guards.books, async (req: Request, res: Response) => {
    const { search, ...page } = parseInput(listSchema, req.query);
    const { items, meta } = await offerService.list({ ...page, search: search || undefined });
    sendSuccess(res, items, { meta });
  });
  router.get('/history/:id', ...guards.books, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await offerService.get(id));
  });

  // The counter opens an offer to ring it up.
  router.get('/:id', ...guards.staff, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await salesDocumentService.offer(id));
  });
  router.post('/:id/decline', ...guards.oversee, async (req: Request, res: Response) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await salesDocumentService.declineOffer(id, req.user!.id), { message: 'Offer turned down' });
  });

  return router;
}
